use crate::dom_attributes::NativeAttributes;
use std::collections::{HashMap, HashSet};

use dom_query::{Document, NodeId, NodeRef};
use lightningcss::properties::PropertyId;
use serde::Serialize;
use taffy::{Overflow, Point, TaffyError, prelude::*};

use crate::{
    Error, MediaEnvironment, Result,
    styles::{Declarations, Variables},
};

mod clamp;
mod clipping;
mod grid;
mod inline;
mod inline_text;
mod lengths;
pub(crate) mod logical;
mod native_tree;
pub(crate) mod order;
mod percentage_padding;
mod replaced;
pub(crate) mod resolved;
mod static_position;
pub(crate) mod svg_viewport;
mod text;
mod text_source;
mod translation;

pub(crate) struct Work<'a> {
    operations: &'a mut usize,
    limit: usize,
    max_nodes: usize,
}
impl<'a> Work<'a> {
    pub(crate) fn new(operations: &'a mut usize, limit: usize, max_nodes: usize) -> Self {
        Self {
            operations,
            limit,
            max_nodes,
        }
    }
    pub(crate) fn node_limit(&self) -> usize {
        self.max_nodes
    }
    pub(crate) fn charge(&mut self) -> Result<()> {
        if *self.operations >= self.limit {
            return Err(Error::Limit("DOM operations"));
        }
        *self.operations = self.operations.saturating_add(1);
        Ok(())
    }
}

#[derive(Clone, Default, Serialize)]
pub(crate) struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn non_rendered(node: NodeRef<'_>) -> bool {
    [
        "head", "script", "style", "link", "meta", "title", "noscript",
    ]
    .iter()
    .any(|name| node.has_name(name))
}

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}

fn unsupported_property(name: &str, value: &str) -> Error {
    if name == "position" {
        unsupported(&format!("position: {value}"))
    } else {
        unsupported(name)
    }
}

fn layout_error(error: &TaffyError) -> Error {
    Error::Dom(format!("layout: {error}"))
}

fn defaulted<'a>(name: &str, value: &'a str) -> &'a str {
    if matches!(name, "max-width" | "max-height") && value == "none" {
        return "auto";
    }
    if matches!(value, "initial" | "unset") {
        match name {
            "width" | "height" | "min-width" | "min-height" | "flex-basis" | "left" | "right"
            | "top" | "bottom" | "align-self" | "max-width" | "max-height" => "auto",
            "margin-left" | "margin-right" | "margin-top" | "margin-bottom" | "padding-left"
            | "padding-right" | "padding-top" | "padding-bottom" | "flex-grow" => "0",
            "flex-shrink" => "1",
            "position" => "static",
            "display" => "inline",
            "box-sizing" => "content-box",
            "flex-direction" => "row",
            "flex-wrap" => "nowrap",
            "visibility" => "visible",
            _ => value,
        }
    } else {
        value
    }
}

fn initial_style(node: NodeRef<'_>, generated: bool) -> Style {
    let mut style = Style {
        display: Display::Block,
        box_sizing: BoxSizing::ContentBox,
        ..Style::default()
    };
    if !generated && node.has_name("body") {
        style.margin = Rect::length(8.0);
    }
    if !generated && node.null_attribute("hidden").is_some() {
        style.display = Display::None;
    }
    style
}

// This first layout pass accepts real inline block/flex and auto-grid boxes. Unsupported
// inputs must fail instead of silently providing manufactured measurements.
fn overflow(value: &str) -> Result<Overflow> {
    match value {
        "visible" => Ok(Overflow::Visible),
        "clip" => Ok(Overflow::Clip),
        "hidden" | "auto" => Ok(Overflow::Hidden),
        _ => Err(unsupported("scrolling overflow")),
    }
}

fn validate_overflow(node: NodeRef<'_>, style: &Style) -> Result<()> {
    if (style.overflow.x == Overflow::Hidden && style.overflow.y == Overflow::Visible)
        || (style.overflow.y == Overflow::Hidden && style.overflow.x == Overflow::Visible)
    {
        return Err(unsupported("mixed scrolling overflow"));
    }
    if (node.has_name("html") || node.has_name("body"))
        && (style.overflow.x != Overflow::Visible || style.overflow.y != Overflow::Visible)
    {
        return Err(unsupported("viewport overflow propagation"));
    }
    Ok(())
}

pub(crate) fn supports(declarations: &Declarations) -> bool {
    if declarations.layout_entries().any(|(name, _, _)| {
        matches!(
            name,
            "color"
                | "-webkit-box-orient"
                | "-webkit-line-clamp"
                | "scroll-margin-top"
                | "scroll-margin-right"
                | "scroll-margin-bottom"
                | "scroll-margin-left"
                | "background-image"
                | "background-repeat"
                | "background-size"
                | "text-overflow"
                | "box-shadow"
                | "opacity"
                | "font-family"
        ) || crate::outlines::property(name)
            || crate::background_layers::property(name)
            || crate::background_position::property(name)
    }) {
        return false;
    }
    if declarations.value("display").0 == "contents"
        && declarations
            .layout_entries()
            .all(|(name, _, _)| name == "display")
    {
        return true;
    }
    let mut operations = 0;
    let mut work = Work::new(&mut operations, 10_000, 1024);
    let Ok(mut fonts) = crate::fonts::Context::new(&MediaEnvironment::default()).compute(
        declarations,
        false,
        &mut work,
    ) else {
        return false;
    };
    if declarations
        .layout_entries()
        .any(|(_, value, _)| value.contains("ch"))
    {
        let Ok(font) = crate::builtin_fonts::select(&format!("{}px serif", fonts.size())) else {
            return false;
        };
        let Ok(width) = crate::font_data::measure(&font, "0", fonts.size()) else {
            return false;
        };
        fonts = fonts.with_zero_advance(width);
    }
    if crate::borders::Borders::default()
        .compute(declarations, &fonts, &mut work)
        .and_then(|borders| borders.geometry())
        .is_err()
    {
        return false;
    }
    let document = Document::from("<div></div>");
    document
        .root()
        .descendants_it()
        .find(|node| node.has_name("div"))
        .is_some_and(|node| style(node, declarations, &fonts, &mut work).is_ok())
}

fn style(
    node: NodeRef<'_>,
    declarations: &Declarations,
    fonts: &crate::fonts::Context,
    work: &mut Work<'_>,
) -> Result<Style> {
    let display = crate::display::Computed::default().compute(node, declarations, false, false)?;
    style_for(node, declarations, false, &display, fonts, work).map(|(style, _)| style)
}

fn non_layout(name: &str) -> bool {
    crate::transitions::property(name)
        || crate::background_layers::property(name)
        || name.starts_with("text-decoration-")
        // These only affect legacy box layout or scrollIntoView, neither supported here.
        || name.starts_with("scroll-margin-")
        || matches!(name, "-webkit-box-orient" | "-webkit-line-clamp")
        || matches!(
            name,
            "color"
                | "border-top-left-radius"
                | "border-top-right-radius"
                | "border-bottom-left-radius"
                | "border-bottom-right-radius"
                | "cursor"
                | "background-color"
                | "background-image"
                | "background-position-x"
                | "background-position-y"
                | "background-repeat"
                | "background-size"
                // CSS ink overflow does not change boxes or scrollable overflow.
                | "text-overflow"
                | "box-shadow"
                | "opacity"
                | "z-index"
                | "visibility"
                | "container-name"
                | "container-type"
                | "font-size"
                | "font-family"
                // Text runs validate inherited typography before shaping.
                | "font-weight"
                | "letter-spacing"
                | "font-style"
                | "font-stretch"
                | "font-variant"
                | "font-feature-settings"
                | "font-variation-settings"
                | "white-space"
                | "text-size-adjust"
                | "text-transform"
                | "tab-size"
                | "line-height"
                | "border-top-color"
                | "border-right-color"
                | "border-bottom-color"
                | "border-left-color"
        )
        || matches!(PropertyId::from(name), PropertyId::UserSelect(_))
}

fn style_for(
    node: NodeRef<'_>,
    declarations: &Declarations,
    generated: bool,
    display: &crate::display::Computed,
    fonts: &crate::fonts::Context,
    work: &mut Work<'_>,
) -> Result<(Style, Option<replaced::Intrinsic>)> {
    let mut style = initial_style(node, generated);
    if !generated
        && (node.has_name("p") || node.has_name("ol") || node.has_name("ul") || node.has_name("dl"))
    {
        use num_traits::ToPrimitive;
        let margin = fonts
            .size()
            .to_f32()
            .ok_or_else(|| unsupported("paragraph margin"))?;
        style.margin.top = LengthPercentageAuto::length(margin);
        style.margin.bottom = LengthPercentageAuto::length(margin);
        if node.has_name("ul") || node.has_name("ol") {
            style.padding.left = LengthPercentage::length(40.0);
        }
    }
    if !generated && node.has_name("dd") {
        style.margin.left = LengthPercentageAuto::length(40.0);
    }
    if !generated {
        replaced::image_attributes(node, &mut style)?;
    }
    let intrinsic = if generated {
        None
    } else {
        svg_viewport::apply(node, &mut style, fonts, work)?
            .or(replaced::Intrinsic::canvas(node, &mut style)?)
    };
    style.display = if clamp::lines(declarations)?.is_some() {
        Ok(Display::Block)
    } else {
        display.layout()
    }
    .map_err(|error| match error {
        Error::Dom(detail) if detail.contains("display formatting") => Error::Dom(format!(
            "{detail} ({})",
            node.qual_name_ref()
                .as_ref()
                .map_or("unknown", |name| name.local.as_ref())
        )),
        other => other,
    })?;
    let mut style = style_properties(node, declarations, generated, fonts, work, style)?;
    if !generated && crate::html_boxes::button(node) {
        style.item_is_replaced = true;
        if style.size.width.is_auto() && style.position != Position::Absolute {
            style.size.width = Dimension::fit_content();
        }
        if matches!(style.display, Display::Block | Display::FlowRoot) {
            style.display = Display::FlowRoot;
            style.align_content = Some(AlignContent::SAFE_CENTER);
        }
    }
    if intrinsic.is_some() && !style.size.width.is_auto() && !style.size.height.is_auto() {
        style.aspect_ratio = None;
    }
    Ok((style, intrinsic))
}

fn ignored_property(name: &str, svg: bool) -> bool {
    name.starts_with("--")
        || translation::Translation::property(name)
        || non_layout(name)
        || (svg && svg_viewport::paint_property(name))
}

fn style_properties(
    node: NodeRef<'_>,
    declarations: &Declarations,
    generated: bool,
    fonts: &crate::fonts::Context,
    work: &mut Work<'_>,
    mut style: Style,
) -> Result<Style> {
    let svg = svg_viewport::root(node);
    translation::Translation::parse(declarations, fonts, work)?;
    macro_rules! assign {
        ($field:expr, $value:expr, $name:expr) => {{
            let value = if $value == "0" && !matches!($name, "flex-grow" | "flex-shrink") {
                "0px"
            } else {
                $value
            };
            let value = lengths::value($name, value, fonts, work)?;
            $field = value.parse().map_err(|_error| unsupported($name))?;
        }};
    }
    if fonts.rtl() {
        style.direction = taffy::Direction::Rtl;
    }
    for (name, value, deferred) in logical::entries(declarations, fonts.rtl()) {
        if generated && name == "content" {
            continue;
        }
        let value = defaulted(name, value);
        if matches!(name, "display" | "order") || name.starts_with("font-variant-") {
            continue;
        }
        if name == "visibility" && (deferred || value == "collapse") {
            return Err(unsupported("visibility"));
        }
        if ignored_property(name, svg) {
            continue;
        }

        if deferred {
            return Err(unsupported("variable substitution"));
        }
        if crate::borders::property(name) || crate::outlines::property(name) {
            continue;
        }
        if grid::apply(&mut style, name, value, fonts, work)?
            || alignment(&mut style, name, value)?
            || crate::html_boxes::non_layout(name, value)
        {
            continue;
        }
        // Atomic inline boxes validate vertical-align separately. It does not
        // apply to the block outer boxes of the other supported modes.
        if name == "vertical-align" {
            continue;
        }
        match name {
            _ if matches!(PropertyId::from(name), PropertyId::Appearance(_))
                && crate::html_boxes::appearance(node, value, style.display, generated) => {}
            "writing-mode"
                if matches!(value, "horizontal-tb" | "initial" | "unset" | "inherit") => {}
            "clip-path" | "direction" => {}
            "box-sizing" => assign!(style.box_sizing, value, name),
            "width" => assign!(style.size.width, value, name),
            "height" => assign!(style.size.height, value, name),
            "min-width" => assign!(style.min_size.width, value, name),
            "min-height" => assign!(style.min_size.height, value, name),
            "max-width" => assign!(style.max_size.width, value, name),
            "max-height" => assign!(style.max_size.height, value, name),
            "margin-left" => assign!(style.margin.left, value, name),
            "margin-right" => assign!(style.margin.right, value, name),
            "margin-top" => assign!(style.margin.top, value, name),
            "margin-bottom" => assign!(style.margin.bottom, value, name),
            "padding-left" => assign!(style.padding.left, value, name),
            "padding-right" => assign!(style.padding.right, value, name),
            "padding-top" => assign!(style.padding.top, value, name),
            "padding-bottom" => assign!(style.padding.bottom, value, name),
            "overflow-x" | "overflow-y" => {
                let overflow = overflow(value)?;
                if name == "overflow-x" {
                    style.overflow.x = overflow;
                } else {
                    style.overflow.y = overflow;
                }
            }
            "position" if matches!(value, "static" | "relative" | "sticky") => {
                flow_position(value, generated)?;
            }
            "position" if matches!(value, "absolute" | "fixed") => {
                absolute_position(&mut style, generated && value == "fixed")?;
            }
            "left" => assign!(style.inset.left, value, name),
            "right" => assign!(style.inset.right, value, name),
            "top" => assign!(style.inset.top, value, name),
            "bottom" => assign!(style.inset.bottom, value, name),
            "grid-auto-flow" => assign!(style.grid_auto_flow, value, name),
            "flex-direction" => assign!(style.flex_direction, value, name),
            "flex-wrap" => assign!(style.flex_wrap, value, name),
            "flex-basis" => assign!(style.flex_basis, value, name),
            "flex-grow" => assign!(style.flex_grow, value, name),
            "flex-shrink" => assign!(style.flex_shrink, value, name),
            "row-gap" => assign!(style.gap.height, value, name),
            "column-gap" => assign!(style.gap.width, value, name),
            _ => return Err(unsupported_property(name, value)),
        }
    }
    if !generated {
        couple_overflow(&mut style, declarations);
        validate_overflow(node, &style)?;
    }
    Ok(position_insets(style, declarations))
}

fn couple_overflow(style: &mut Style, declarations: &Declarations) {
    if declarations.value("overflow-x").0 == "auto" || declarations.value("overflow-y").0 == "auto"
    {
        if style.overflow.x == Overflow::Visible {
            style.overflow.x = Overflow::Hidden;
        }
        if style.overflow.y == Overflow::Visible {
            style.overflow.y = Overflow::Hidden;
        }
    }
}

fn alignment(style: &mut Style, name: &str, value: &str) -> Result<bool> {
    match name {
        "align-items" => {
            style.align_items = Some(value.parse().map_err(|_error| unsupported(name))?);
        }
        "justify-items" => {
            style.justify_items = if matches!(value, "normal" | "initial" | "unset") {
                None
            } else {
                Some(value.parse().map_err(|_error| unsupported(name))?)
            }
        }
        "align-self" => {
            style.align_self = if value == "auto" {
                None
            } else {
                Some(value.parse().map_err(|_error| unsupported(name))?)
            }
        }
        "align-content" => {
            style.align_content = if matches!(value, "normal" | "initial" | "unset" | "revert") {
                None
            } else {
                Some(value.parse().map_err(|_error| unsupported(name))?)
            };
        }
        "justify-content" => {
            style.justify_content = Some(value.parse().map_err(|_error| unsupported(name))?);
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn absolute_position(style: &mut Style, generated_fixed: bool) -> Result<()> {
    if generated_fixed {
        return Err(unsupported("fixed generated boxes"));
    }
    style.position = Position::Absolute;
    Ok(())
}

fn flow_position(value: &str, generated: bool) -> Result<()> {
    if value == "sticky" && generated {
        return Err(unsupported("sticky generated boxes"));
    }
    Ok(())
}

fn position_insets(mut style: Style, declarations: &Declarations) -> Style {
    if style.position != Position::Absolute
        && !declarations
            .layout_entries()
            .any(|(name, value, _)| name == "position" && value == "relative")
    {
        style.inset = Rect::auto();
    }
    style
}

// Empty generated strings create real boxes. Non-empty content requires the
// same shaping/image/counter machinery as ordinary content; do not fabricate
// its size while that machinery is unavailable.
fn empty_generated_content(declarations: &Declarations) -> Result<bool> {
    let Some((_, value, deferred)) = declarations
        .layout_entries()
        .find(|(name, _, _)| *name == "content")
    else {
        return Ok(false);
    };
    if deferred {
        return Err(unsupported("variable substitution"));
    }
    if matches!(value, "none" | "normal" | "initial" | "unset") {
        return Ok(false);
    }
    let mut input = cssparser::ParserInput::new(value);
    let mut parser = cssparser::Parser::new(&mut input);
    let mut strings = 0_usize;
    while !parser.is_exhausted() {
        match parser
            .next()
            .map_err(|_error| unsupported("generated content"))?
        {
            cssparser::Token::QuotedString(value) if value.is_empty() => {
                strings = strings.saturating_add(1);
            }
            cssparser::Token::QuotedString(_) => return Err(unsupported("text shaping")),
            cssparser::Token::Delim('/') if strings > 0 => return Ok(true),
            _ => return Err(unsupported("generated content")),
        }
    }
    Ok(strings > 0)
}

#[derive(Clone, Copy)]
struct FormattingContext<'a> {
    display: Display,
    context: &'a BoxContext,
}

#[derive(Clone)]
struct BoxContext {
    fonts: crate::fonts::Context,
    borders: crate::borders::Borders,
    outlines: crate::outlines::Outlines,
    images: crate::backgrounds::Images,
    positions: crate::background_position::Positions,
    repeats: crate::background_repeat::Repeats,
    sizes: crate::background_size::Sizes,
    layers: crate::background_layers::Layers,
    family: crate::font_family::Family,
    clamp: Option<u32>,
    display: crate::display::Computed,
    typography: text::Typography,
    markerless: bool,
    row_flex: bool,
    order: i32,
}

impl BoxContext {
    fn initial(media: &MediaEnvironment) -> Self {
        Self {
            fonts: crate::fonts::Context::new(media),
            borders: crate::borders::Borders::default(),
            outlines: crate::outlines::Outlines::default(),
            images: crate::backgrounds::Images::default(),
            positions: crate::background_position::Positions::default(),
            repeats: crate::background_repeat::Repeats::default(),
            sizes: crate::background_size::Sizes::default(),
            layers: crate::background_layers::Layers::default(),
            family: crate::font_family::Family::default(),
            clamp: None,
            display: crate::display::Computed::default(),
            typography: text::Typography::default(),
            markerless: false,
            row_flex: false,
            order: 0,
        }
    }

    fn markerless(&self, declarations: &Declarations) -> bool {
        match declarations.value("list-style-type").0.as_str() {
            "none" => true,
            "" | "inherit" | "unset" => self.markerless,
            _ => false,
        }
    }
    fn validate_display(
        &self,
        node: NodeRef<'_>,
        declarations: &Declarations,
        display: crate::display::Computed,
    ) -> Result<crate::display::Computed> {
        if node.has_name("fieldset") && display.contents() {
            return Ok(display);
        }
        let markerless = self.markerless(declarations);
        crate::html_boxes::validate(
            node,
            declarations,
            display.atomic_container(),
            markerless,
            self.row_flex,
        )?;
        Ok(if node.has_name("li") && markerless {
            display.markerless()
        } else {
            display
        })
    }
    fn compute(
        &self,
        declarations: &Declarations,
        root: bool,
        node: NodeRef<'_>,
        display: crate::display::Computed,
        arena: &crate::font_data::Arena,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let mut fonts = self.fonts.compute(declarations, root, work)?;
        let family = self.family.compute(declarations, work)?;
        let typography = self.typography.compute(declarations, node, &fonts, work)?;
        if declarations
            .layout_entries()
            .any(|(_, value, _)| value.contains("ch"))
        {
            fonts = fonts.with_zero_advance(typography.zero_advance(&fonts, &family, arena, work)?);
        }
        let borders = self.borders.compute(declarations, &fonts, work)?;
        let outlines = self.outlines.compute(declarations, &fonts, work)?;
        let images = self.images.compute(declarations, &fonts, work)?;
        images.validate()?;
        let positions = self.positions.compute(declarations, &fonts, work)?;
        positions.validate()?;
        let repeats = self.repeats.compute(declarations, images.count(), work)?;
        let sizes = self
            .sizes
            .compute(declarations, images.count(), &fonts, work)?;
        sizes.validate()?;
        let layers = self.layers.compute(declarations, images.count(), work)?;
        Ok(Self {
            fonts,
            borders,
            outlines,
            images,
            positions,
            repeats,
            sizes,
            layers,
            family,
            clamp: clamp::lines(declarations)?,
            row_flex: if display.contents() {
                self.row_flex
            } else {
                display.atomic_container()
                    && display.layout()? == Display::Flex
                    && !matches!(
                        declarations.value("flex-direction").0.as_str(),
                        "column" | "column-reverse"
                    )
            },
            display,
            typography,
            markerless: self.markerless(declarations),
            order: order::compute(self.order, declarations)?,
        })
    }
}

struct Tree<'a, 'b> {
    computed: &'a mut crate::styles::ComputedCache,
    images: &'a std::cell::RefCell<crate::images::Images>,
    image_base: Option<&'a str>,
    resolved: HashMap<NodeId, (Declarations, Variables)>,
    folded_inlines: HashSet<NodeId>,
    boxes: native_tree::Boxes,
    ids: HashMap<NodeId, taffy::NodeId>,
    positioned: HashSet<NodeId>,
    fixed: HashSet<NodeId>,
    out_of_flow: Vec<(taffy::NodeId, Option<NodeId>)>,
    box_nodes: HashMap<taffy::NodeId, NodeId>,
    orders: HashMap<taffy::NodeId, i32>,
    inline_atoms: HashSet<taffy::NodeId>,
    sticky: HashMap<taffy::NodeId, Rect<LengthPercentageAuto>>,
    translations: HashMap<taffy::NodeId, translation::Translation>,
    transformed: HashSet<NodeId>,
    translated_overflow: HashMap<taffy::NodeId, Point<f64>>,
    automatic_overflow: HashSet<taffy::NodeId>,
    clips: HashMap<taffy::NodeId, clipping::Clip>,
    percentage_padding: Vec<(taffy::NodeId, Rect<LengthPercentage>)>,
    scroll: &'a ScrollState,
    fonts: &'a std::cell::RefCell<crate::font_data::Arena>,
    text_budget: std::rc::Rc<text::Budget>,
    transitions: &'a std::cell::RefCell<crate::transitions::State>,
    now: f64,
    viewport: Size<f64>,
    styles: &'a HashMap<NodeId, Declarations>,
    visited: usize,
    cascade: &'a crate::cascade::Cascade,
    controls: &'a crate::dom::control_selectors::View<'a>,
    containers: &'a crate::containers::Snapshot,
    next_containers: crate::containers::Snapshot,
    work: &'a mut Work<'b>,
}

impl Tree<'_, '_> {
    fn animate(
        &mut self,
        declarations: &Declarations,
        variables: &Variables,
    ) -> Result<Declarations> {
        self.cascade.animations.sample(
            declarations,
            variables,
            &self.cascade.registrations,
            self.work,
        )
    }
    fn visit(&mut self, depth: usize) -> Result<()> {
        self.work.charge()?;
        self.visited = self.visited.saturating_add(1);
        if self.visited > self.work.max_nodes {
            return Err(Error::Limit("layout tree: nodes"));
        }
        if depth > 128 {
            return Err(Error::Limit("layout tree: depth"));
        }
        Ok(())
    }
    fn generated(
        &mut self,
        node: NodeRef<'_>,
        kind: crate::cascade::Generated,
        parent: &Variables,
        parent_display: Display,
        depth: usize,
        context: &BoxContext,
    ) -> Result<Option<taffy::NodeId>> {
        let declarations = self.cascade.resolve(
            node,
            &Declarations::default(),
            Some(kind),
            self.containers,
            Some(self.controls),
            self.work,
        )?;
        let (declarations, variables) = self.computed.compute(
            &declarations,
            parent,
            &self.cascade.registrations,
            self.work,
        )?;
        let declarations = self.animate(&declarations, &variables)?;
        if declarations
            .layout_entries()
            .any(|(name, value, _)| name == "display" && value == "none")
        {
            return Ok(None);
        }
        if !empty_generated_content(&declarations)? {
            return Ok(None);
        }
        if !matches!(parent_display, Display::Flex | Display::Grid)
            && declarations.value("position").0 != "absolute"
            && !declarations.layout_entries().any(|(name, value, _)| {
                name == "display" && matches!(value, "block" | "flex" | "grid")
            })
        {
            return Err(unsupported("generated inline formatting"));
        }
        self.visit(depth)?;
        let display = context.display.compute(node, &declarations, false, true)?;
        if display.contents() {
            return Ok(None);
        }
        let context = context.compute(
            &declarations,
            false,
            node,
            display,
            &self.fonts.borrow(),
            self.work,
        )?;
        let (mut style, _) = style_for(
            node,
            &declarations,
            true,
            &context.display,
            &context.fonts,
            self.work,
        )?;
        style.border = context.borders.geometry()?;
        let out_of_flow = style.position == Position::Absolute;
        let id = self
            .boxes
            .new_leaf(style)
            .map_err(|error| layout_error(&error))?;
        self.remember_padding(id)?;
        self.orders.insert(id, context.order);
        if let Some(translation) =
            translation::Translation::parse(&declarations, &context.fonts, self.work)?
        {
            self.translations.insert(id, translation);
        }
        if out_of_flow {
            // The originating element establishes the containing block when positioned.
            // Keep the generated box distinct from its owner in the DOM-to-box map.
            let containing = std::iter::once(node)
                .chain(node.ancestors_it(None))
                .find(|ancestor| {
                    self.positioned.contains(&ancestor.id)
                        || self.transformed.contains(&ancestor.id)
                })
                .map(|ancestor| ancestor.id);
            self.out_of_flow.push((id, containing));
        }
        Ok(Some(id))
    }
    fn resolve_node(
        &mut self,
        node: NodeRef<'_>,
        parent: &Variables,
    ) -> Result<(Declarations, Variables)> {
        if let Some(resolved) = self.resolved.get(&node.id) {
            return Ok(resolved.clone());
        }
        let declarations = if let Some(state) = self.styles.get(&node.id) {
            state.clone()
        } else {
            Declarations::parse(node.null_attribute("style").as_deref().unwrap_or_default())
                .map_err(|message| Error::Dom(message.into()))?
        };
        let declarations = self.cascade.resolve(
            node,
            &declarations,
            None,
            self.containers,
            Some(self.controls),
            self.work,
        )?;
        let (declarations, variables) = self.computed.compute(
            &declarations,
            parent,
            &self.cascade.registrations,
            self.work,
        )?;
        let declarations = crate::html_boxes::computed_defaults(node, declarations)?;
        let declarations = self.animate(&declarations, &variables)?;
        let declarations = self
            .transitions
            .borrow_mut()
            .sample(node, declarations, self.now)?;
        self.resolved
            .insert(node.id, (declarations.clone(), variables.clone()));
        Ok((declarations, variables))
    }
    fn build(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        parent: &Variables,
        formatting: FormattingContext<'_>,
        parent_context: &BoxContext,
        output: &mut Vec<taffy::NodeId>,
    ) -> Result<()> {
        self.visit(depth)?;
        if !node.is_element() {
            if node.is_text()
                && !node
                    .text()
                    .trim_matches([' ', '\t', '\n', '\r', '\u{c}'])
                    .is_empty()
            {
                return Err(unsupported("text shaping"));
            }
            return Ok(());
        }
        if non_rendered(node) {
            return Ok(());
        }
        let (declarations, variables) = self.resolve_node(node, parent)?;
        let display = parent_context
            .display
            .compute(node, &declarations, depth == 0, false)?;
        if display.none() {
            return Ok(());
        }
        let display = parent_context.validate_display(node, &declarations, display)?;
        if display.contents() {
            let context = parent_context.compute(
                &declarations,
                false,
                node,
                display,
                &self.fonts.borrow(),
                self.work,
            )?;
            return self.children(node, depth, &variables, formatting, &context, output);
        }
        let context = parent_context.compute(
            &declarations,
            depth == 0,
            node,
            display,
            &self.fonts.borrow(),
            self.work,
        )?;
        let (mut style, mut intrinsic) = style_for(
            node,
            &declarations,
            false,
            &context.display,
            &context.fonts,
            self.work,
        )?;
        if crate::images::element(node) {
            let info = self.images.borrow_mut().info(node, self.image_base, true)?;
            intrinsic = Some(replaced::Intrinsic::image(node, &mut style, &info)?);
        }
        style.border = context.borders.geometry()?;
        if node.has_name("input") {
            style.item_is_replaced = true;
        }
        inline::atomic_style(&mut style, &context.display, &declarations)?;
        let fonts = context.fonts;
        let container = crate::containers::Container::apply(&declarations, &mut style, fonts)?;
        let (position, _) = declarations.value("position");
        let position = defaulted("position", &position);
        let out_of_flow = style.position == Position::Absolute;
        let containing = self.containing_block(node, position, &declarations, &fonts)?;
        let id = self.build_box(node, depth, &variables, &context, style, intrinsic)?;
        self.record_box(node.id, id, position, &declarations, &fonts)?;
        self.remember_inline_item(id, &context, formatting.context, &declarations)?;
        if out_of_flow {
            if position == "fixed" && containing.is_some() {
                self.fixed.remove(&node.id);
            }
            self.out_of_flow.push((id, containing));
        }
        if let Some(container) = container {
            self.boxes.contain(id, container.axes());
            self.next_containers.insert(node.id, container);
        }
        output.push(id);
        Ok(())
    }
    fn validate_automatic_overflow(&self) -> Result<()> {
        for id in &self.automatic_overflow {
            let layout = self
                .boxes
                .layout(*id)
                .map_err(|error| layout_error(&error))?;
            let overflow = self.translated_overflow.get(id).copied().unwrap_or(Point {
                x: f64::from(layout.scroll_width()),
                y: f64::from(layout.scroll_height()),
            });
            if overflow.x > 0.001 || overflow.y > 0.001 {
                return Err(unsupported("automatic scrollbar gutters"));
            }
        }
        Ok(())
    }
    fn build_box(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        variables: &Variables,
        context: &BoxContext,
        mut style: Style,
        intrinsic: Option<replaced::Intrinsic>,
    ) -> Result<taffy::NodeId> {
        let id = if let Some(intrinsic) = intrinsic {
            self.leaf(style, text::Intrinsic::Replaced(intrinsic))
        } else if node.has_name("input") {
            let run = text::Run::strut(
                &context.typography,
                context,
                &self.fonts.borrow(),
                std::rc::Rc::clone(&self.text_budget),
            )?;
            self.leaf(style, text::Intrinsic::Text(run))
        } else if let Some(run) = self.text_run(node, depth, variables, style.display, context)? {
            if let Some(lines) = context.clamp {
                clamp::apply(&mut style, run.line_height(), lines)?;
            }
            self.leaf(style, text::Intrinsic::Text(run))
        } else {
            let mut children = Vec::new();
            self.children(
                node,
                depth,
                variables,
                FormattingContext {
                    display: style.display,
                    context,
                },
                context,
                &mut children,
            )?;
            if context.display.inline_atomic()
                && style.display == Display::FlowRoot
                && !children.is_empty()
                && !crate::html_boxes::button(node)
            {
                return Err(unsupported("nested block inline formatting"));
            }
            self.inline_flow(&mut style, &mut children, context)?;
            self.boxes.new_with_children(style, &children)
        }
        .map_err(|error| layout_error(&error))?;
        Ok(id)
    }
    fn text_run(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        variables: &Variables,
        display: Display,
        context: &BoxContext,
    ) -> Result<Option<text::Run>> {
        if crate::html_boxes::button(node)
            || !matches!(display, Display::Block | Display::FlowRoot)
            || node.children_it(false).any(|child| {
                child.is_element() && !non_rendered(child) && !crate::html_boxes::text_inline(child)
            })
        {
            return Ok(None);
        }
        let mut source = text_source::Source::new(context);
        let mut folded = Vec::new();
        if !self.inline_source(node, depth, variables, context, &mut source, &mut folded)? {
            return Ok(None);
        }
        if source
            .text
            .trim_matches([' ', '\t', '\n', '\r', '\u{c}'])
            .is_empty()
            && source.padding.is_empty()
            && !(context.typography.preserves_breaks() && source.text.contains(['\n', '\r']))
        {
            return Ok(None);
        }
        self.folded_inlines.extend(folded);
        for kind in [
            crate::cascade::Generated::Before,
            crate::cascade::Generated::After,
        ] {
            if self
                .generated(
                    node,
                    kind,
                    variables,
                    display,
                    depth.saturating_add(1),
                    context,
                )?
                .is_some()
            {
                return Err(unsupported("generated content in text formatting context"));
            }
        }
        text::Run::new(
            &source,
            &context.typography,
            context,
            &self.fonts.borrow(),
            std::rc::Rc::clone(&self.text_budget),
        )
    }
    fn containing_block(
        &mut self,
        node: NodeRef<'_>,
        position: &str,
        declarations: &Declarations,
        fonts: &crate::fonts::Context,
    ) -> Result<Option<NodeId>> {
        let transformed =
            translation::Translation::parse(declarations, fonts, self.work)?.is_some();
        if transformed {
            self.transformed.insert(node.id);
            self.positioned.insert(node.id);
        }
        let containing = if position == "fixed" {
            node.ancestors_it(None)
                .find(|ancestor| self.transformed.contains(&ancestor.id))
                .map(|ancestor| ancestor.id)
        } else if position == "absolute" {
            node.ancestors_it(None)
                .find(|ancestor| {
                    self.positioned.contains(&ancestor.id)
                        || self.transformed.contains(&ancestor.id)
                })
                .map(|ancestor| ancestor.id)
        } else {
            None
        };
        // display:contents contributes no box; size containers alone do not
        // establish positioning containing blocks in CSS Conditional Rules 5.
        if matches!(position, "relative" | "absolute" | "fixed" | "sticky") {
            self.positioned.insert(node.id);
        }
        Ok(containing)
    }
    fn record_box(
        &mut self,
        node: NodeId,
        id: taffy::NodeId,
        position: &str,
        declarations: &Declarations,
        fonts: &crate::fonts::Context,
    ) -> Result<()> {
        self.remember_padding(id)?;
        if let Some(translation) = translation::Translation::parse(declarations, fonts, self.work)?
        {
            self.translations.insert(id, translation);
        }
        if declarations.value("overflow-x").0 == "auto"
            || declarations.value("overflow-y").0 == "auto"
        {
            self.automatic_overflow.insert(id);
        }
        self.ids.insert(node, id);
        self.box_nodes.insert(id, node);
        let (value, deferred) = declarations.value("clip-path");
        if deferred {
            return Err(unsupported("clip-path variable substitution"));
        }
        if let Some(clip) = clipping::Clip::parse(&value, *fonts, self.work)? {
            self.clips.insert(id, clip);
        }
        if position == "sticky" {
            self.sticky
                .insert(id, geometry::insets(declarations, fonts, self.work)?);
        }
        if position == "fixed" {
            self.fixed.insert(node);
        }
        Ok(())
    }
    fn position_boxes(
        &mut self,
        root: taffy::NodeId,
        width: f32,
        height: f32,
    ) -> Result<taffy::NodeId> {
        if self.out_of_flow.is_empty() {
            return Ok(root);
        }
        let viewport = if self.out_of_flow.iter().any(|(_, parent)| parent.is_none()) {
            self.visit(0)?;
            Some(
                self.boxes
                    .new_with_children(
                        Style {
                            display: Display::Block,
                            size: Size {
                                width: Dimension::length(width),
                                height: Dimension::length(height),
                            },
                            ..Style::default()
                        },
                        &[root],
                    )
                    .map_err(|error| layout_error(&error))?,
            )
        } else {
            None
        };
        self.prepare_static_positions(root, viewport, width, height)?;
        for (id, containing) in &self.out_of_flow {
            self.work.charge()?;
            let parent = if let Some(node) = containing {
                self.ids.get(node).copied()
            } else {
                viewport
            }
            .ok_or_else(|| unsupported("missing positioning containing block"))?;
            if self.boxes.parent(*id) == Some(parent) {
                continue;
            }
            let style = self
                .boxes
                .style(*id)
                .map_err(|error| layout_error(&error))?;
            if (style.inset.left.is_auto() && style.inset.right.is_auto())
                || (style.inset.top.is_auto() && style.inset.bottom.is_auto())
            {
                return Err(unsupported(
                    "absolute static position across containing blocks",
                ));
            }
            if let Some(old) = self.boxes.parent(*id) {
                self.boxes
                    .remove_child(old, *id)
                    .map_err(|error| layout_error(&error))?;
            }
            self.boxes
                .add_child(parent, *id)
                .map_err(|error| layout_error(&error))?;
        }
        Ok(viewport.unwrap_or(root))
    }
    fn text_item(
        &mut self,
        source: &mut text_source::Source<'_>,
        context: &BoxContext,
        output: &mut Vec<taffy::NodeId>,
    ) -> Result<()> {
        if source.text.is_empty() && source.padding.is_empty() {
            return Ok(());
        }
        let run = text::Run::new(
            source,
            &context.typography,
            context,
            &self.fonts.borrow(),
            std::rc::Rc::clone(&self.text_budget),
        )?;
        source.text.clear();
        source.padding.clear();
        source.spans.clear();
        source.boxes.clear();
        if let Some(run) = run {
            self.visit(0)?;
            let id = self
                .boxes
                .new_leaf_with_context(
                    Style {
                        display: Display::Block,
                        ..Style::default()
                    },
                    text::Intrinsic::Text(run),
                )
                .map_err(|error| layout_error(&error))?;
            output.push(id);
        }
        Ok(())
    }
    fn children(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        variables: &Variables,
        formatting: FormattingContext<'_>,
        context: &BoxContext,
        output: &mut Vec<taffy::NodeId>,
    ) -> Result<()> {
        if let Some(before) = self.generated(
            node,
            crate::cascade::Generated::Before,
            variables,
            formatting.display,
            depth.saturating_add(1),
            context,
        )? {
            output.push(before);
        }
        let anonymous = matches!(formatting.display, Display::Flex | Display::Grid);
        let block_flow = matches!(formatting.display, Display::Block | Display::FlowRoot);
        let mut source = text_source::Source::new(context);
        let mut folded = Vec::new();
        let mut child_boxes = Vec::new();
        for child in node.children_it(false) {
            if block_flow
                && !context.display.contents()
                && self.inline_child(
                    child,
                    depth.saturating_add(1),
                    variables,
                    context,
                    &mut source,
                    &mut folded,
                )?
            {
                continue;
            }
            if anonymous && (child.is_text() || child.is_comment()) {
                self.visit(depth.saturating_add(1))?;
                if child.is_text() {
                    if context.display.contents() && !child.text().trim().is_empty() {
                        return Err(unsupported("anonymous text through display:contents"));
                    }
                    source.append(&child.text(), context)?;
                }
                continue;
            }
            self.build(
                child,
                depth.saturating_add(1),
                variables,
                formatting,
                context,
                &mut child_boxes,
            )?;
            if !child_boxes.is_empty() {
                let separates_text = !block_flow
                    || child_boxes.iter().try_fold(false, |separates, id| {
                        Ok::<_, Error>(
                            separates
                                || self
                                    .boxes
                                    .style(*id)
                                    .map_err(|error| layout_error(&error))?
                                    .position
                                    != Position::Absolute,
                        )
                    })?;
                if separates_text {
                    self.text_item(&mut source, context, output)?;
                }
                output.append(&mut child_boxes);
            }
        }
        self.text_item(&mut source, context, output)?;
        if let Some(after) = self.generated(
            node,
            crate::cascade::Generated::After,
            variables,
            formatting.display,
            depth.saturating_add(1),
            context,
        )? {
            output.push(after);
        }
        self.folded_inlines.extend(folded);
        if matches!(formatting.display, Display::Flex | Display::Grid) {
            output.sort_by_key(|id| self.orders.get(id).copied().unwrap_or_default());
        }
        Ok(())
    }
}

pub(crate) struct Sources<'a> {
    pub images: &'a std::cell::RefCell<crate::images::Images>,
    pub image_base: Option<&'a str>,
    pub scroll: &'a ScrollState,
    pub transitions: &'a std::cell::RefCell<crate::transitions::State>,
    pub now: f64,
    pub inline: &'a HashMap<NodeId, Declarations>,
    pub cascade: &'a crate::cascade::Cascade,
    pub controls: crate::dom::control_selectors::View<'a>,
    pub fonts: &'a std::cell::RefCell<crate::font_data::Arena>,
}

fn scene<T>(
    document: &Document,
    styles: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
    measure: impl FnOnce(&mut Tree<'_, '_>) -> Result<T>,
) -> Result<T> {
    let cascade = styles.cascade;
    let root = document
        .root()
        .children_it(false)
        .find(NodeRef::is_element)
        .ok_or_else(|| unsupported("document root"))?;
    let width = f32::from(u16::try_from(media.width).map_err(|_error| unsupported("viewport"))?);
    let height = f32::from(u16::try_from(media.height).map_err(|_error| unsupported("viewport"))?);
    let mut containers = crate::containers::Snapshot::new();
    let mut computed = crate::styles::ComputedCache::default();
    let root_variables = Variables::default();
    for _round in 0..=32 {
        let mut tree = Tree {
            computed: &mut computed,
            images: styles.images,
            image_base: styles.image_base,
            resolved: HashMap::new(),
            folded_inlines: HashSet::new(),
            boxes: native_tree::Boxes::new(),
            ids: HashMap::new(),
            positioned: HashSet::new(),
            fixed: HashSet::new(),
            out_of_flow: Vec::new(),
            box_nodes: HashMap::new(),
            orders: HashMap::new(),
            inline_atoms: HashSet::new(),
            sticky: HashMap::new(),
            translations: HashMap::new(),
            transformed: HashSet::new(),
            translated_overflow: HashMap::new(),
            automatic_overflow: HashSet::new(),
            clips: HashMap::new(),
            percentage_padding: Vec::new(),
            scroll: styles.scroll,
            fonts: styles.fonts,
            text_budget: std::rc::Rc::default(),
            transitions: styles.transitions,
            now: styles.now,
            viewport: Size {
                width: f64::from(width),
                height: f64::from(height),
            },
            styles: styles.inline,
            visited: 0,
            cascade,
            controls: &styles.controls,
            containers: &containers,
            next_containers: crate::containers::Snapshot::new(),
            work,
        };
        tree.boxes.disable_rounding();
        let mut root_ids = Vec::new();
        let initial_context = BoxContext::initial(media);
        tree.build(
            root,
            0,
            &root_variables,
            FormattingContext {
                display: Display::Block,
                context: &initial_context,
            },
            &initial_context,
            &mut root_ids,
        )?;
        if let Some(root_id) = root_ids.first().copied() {
            let root_id = tree.position_boxes(root_id, width, height)?;
            tree.compute_layout(root_id, width, height)?;
            if !tree.translations.is_empty() {
                tree.translation_overflow(root_id)?;
            }
            tree.validate_automatic_overflow()?;
        }
        for (node, container) in &mut tree.next_containers {
            let id = tree
                .ids
                .get(node)
                .ok_or_else(|| unsupported("missing box"))?;
            container.measure(
                tree.boxes
                    .layout(*id)
                    .map_err(|error| layout_error(&error))?,
            );
        }
        if !cascade.has_containers() || tree.next_containers == containers {
            return measure(&mut tree);
        }
        containers = tree.next_containers;
    }
    Err(Error::Limit("container layout passes"))
}

mod intersection;
pub(crate) use intersection::Margins;

mod geometry;
pub(crate) use geometry::{ScrollState, Snapshot, snapshot};
