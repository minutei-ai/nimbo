use std::collections::{HashMap, HashSet};

use dom_query::{Document, NodeId, NodeRef};
use serde::Serialize;
use taffy::{Overflow, TaffyError, prelude::*};

use crate::{
    Error, MediaEnvironment, Result,
    styles::{Declarations, Variables},
};

mod lengths;
pub(crate) mod logical;

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

fn initial_style(node: NodeRef<'_>, generated: bool) -> Result<Style> {
    if node
        .attr("dir")
        .is_some_and(|value| value.eq_ignore_ascii_case("rtl"))
    {
        return Err(unsupported("direction"));
    }
    let mut style = Style {
        display: Display::Block,
        box_sizing: BoxSizing::ContentBox,
        ..Style::default()
    };
    if !generated && node.has_name("body") {
        style.margin = Rect::length(8.0);
    }
    if !generated && node.has_attr("hidden") {
        style.display = Display::None;
    }
    Ok(style)
}

// This first layout pass accepts real inline block/flex and auto-grid boxes. Unsupported
// inputs must fail instead of silently providing manufactured measurements.
fn overflow(value: &str) -> Result<Overflow> {
    match value {
        "visible" => Ok(Overflow::Visible),
        "clip" => Ok(Overflow::Clip),
        "hidden" => Ok(Overflow::Hidden),
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
                | "background-color"
                | "background-image"
                | "background-repeat"
                | "background-size"
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
    let Ok(fonts) = crate::fonts::Context::new(&MediaEnvironment::default()).compute(
        declarations,
        false,
        &mut work,
    ) else {
        return false;
    };
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
        .is_some_and(|node| style(node, declarations).is_ok())
}

fn style(node: NodeRef<'_>, declarations: &Declarations) -> Result<Style> {
    let display = crate::display::Computed::default().compute(node, declarations, false, false)?;
    let mut operations = 0;
    let mut work = Work::new(&mut operations, 10_000, 1024);
    let fonts = crate::fonts::Context::new(&MediaEnvironment::default()).compute(
        declarations,
        false,
        &mut work,
    )?;
    style_for(node, declarations, false, &display, &fonts, &mut work)
}

fn non_layout(name: &str) -> bool {
    crate::transitions::property(name)
        || crate::background_layers::property(name)
        || name.starts_with("text-decoration-")
        || matches!(
            name,
            "color"
                | "cursor"
                | "background-color"
                | "background-image"
                | "background-position-x"
                | "background-position-y"
                | "background-repeat"
                | "background-size"
                | "opacity"
                | "z-index"
                | "visibility"
                | "container-name"
                | "container-type"
                | "font-size"
                | "font-family"
                | "text-size-adjust"
                | "tab-size"
                | "line-height"
                | "border-top-color"
                | "border-right-color"
                | "border-bottom-color"
                | "border-left-color"
        )
}

fn style_for(
    node: NodeRef<'_>,
    declarations: &Declarations,
    generated: bool,
    display: &crate::display::Computed,
    fonts: &crate::fonts::Context,
    work: &mut Work<'_>,
) -> Result<Style> {
    let mut style = initial_style(node, generated)?;
    style.display = display.layout()?;
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
    for (name, value, deferred) in logical::entries(declarations) {
        if generated && name == "content" {
            continue;
        }
        let value = defaulted(name, value);
        if name == "display" {
            continue;
        }
        if name == "visibility" && (deferred || value == "collapse") {
            return Err(unsupported("visibility"));
        }
        if name.starts_with("--") || non_layout(name) {
            continue;
        }

        if deferred {
            return Err(unsupported("variable substitution"));
        }
        if crate::borders::property(name) || crate::outlines::property(name) {
            continue;
        }
        match name {
            "writing-mode"
                if matches!(value, "horizontal-tb" | "initial" | "unset" | "inherit") => {}
            "direction" if matches!(value, "ltr" | "initial" | "unset" | "inherit") => {}
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
                absolute_position(&mut style, generated)?;
            }
            "left" => assign!(style.inset.left, value, name),
            "right" => assign!(style.inset.right, value, name),
            "top" => assign!(style.inset.top, value, name),
            "bottom" => assign!(style.inset.bottom, value, name),
            "flex-direction" => assign!(style.flex_direction, value, name),
            "flex-wrap" => assign!(style.flex_wrap, value, name),
            "flex-basis" => assign!(style.flex_basis, value, name),
            "flex-grow" => assign!(style.flex_grow, value, name),
            "flex-shrink" => assign!(style.flex_shrink, value, name),
            "row-gap" => assign!(style.gap.height, value, name),
            "column-gap" => assign!(style.gap.width, value, name),
            "align-items" => {
                style.align_items = Some(value.parse().map_err(|_error| unsupported(name))?);
            }
            "align-self" => {
                style.align_self = if value == "auto" {
                    None
                } else {
                    Some(value.parse().map_err(|_error| unsupported(name))?)
                }
            }
            "align-content" => {
                style.align_content = Some(value.parse().map_err(|_error| unsupported(name))?);
            }
            "justify-content" => {
                style.justify_content = Some(value.parse().map_err(|_error| unsupported(name))?);
            }
            _ => return Err(unsupported_property(name, value)),
        }
    }
    if !generated {
        validate_overflow(node, &style)?;
    }
    position_insets(style, declarations)
}

fn absolute_position(style: &mut Style, generated: bool) -> Result<()> {
    if generated {
        return Err(unsupported("positioned generated boxes"));
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

fn position_insets(mut style: Style, declarations: &Declarations) -> Result<Style> {
    // Static boxes ignore insets. Out-of-flow boxes need explicit coordinates
    // until CSS static-position rectangles are implemented.
    if style.position == Position::Absolute {
        if (style.inset.left.is_auto() && style.inset.right.is_auto())
            || (style.inset.top.is_auto() && style.inset.bottom.is_auto())
        {
            return Err(unsupported("absolute static position"));
        }
    } else if !declarations
        .layout_entries()
        .any(|(name, value, _)| name == "position" && value == "relative")
    {
        style.inset = Rect::auto();
    }
    Ok(style)
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
    display: crate::display::Computed,
}

impl BoxContext {
    fn compute(
        &self,
        declarations: &Declarations,
        root: bool,
        display: crate::display::Computed,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let fonts = self.fonts.compute(declarations, root, work)?;
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
        let family = self.family.compute(declarations, work)?;
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
            display,
        })
    }
}

struct Tree<'a, 'b> {
    boxes: TaffyTree<()>,
    ids: HashMap<NodeId, taffy::NodeId>,
    positioned: HashSet<NodeId>,
    fixed: HashSet<NodeId>,
    out_of_flow: Vec<(taffy::NodeId, Option<NodeId>)>,
    box_nodes: HashMap<taffy::NodeId, NodeId>,
    sticky: HashMap<taffy::NodeId, Rect<LengthPercentageAuto>>,
    scroll: &'a ScrollState,
    transitions: &'a std::cell::RefCell<crate::transitions::State>,
    now: f64,
    viewport: Size<f64>,
    styles: &'a HashMap<NodeId, Declarations>,
    visited: usize,
    cascade: &'a crate::cascade::Cascade,
    containers: &'a crate::containers::Snapshot,
    next_containers: crate::containers::Snapshot,
    work: &'a mut Work<'b>,
}

impl Tree<'_, '_> {
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
            self.work,
        )?;
        let (declarations, variables) =
            declarations.compute_registered(parent, &self.cascade.registrations, self.work)?;
        let declarations = self
            .cascade
            .animations
            .sample(&declarations, &variables, self.work)?;
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
        let context = context.compute(&declarations, false, display, self.work)?;
        let mut style = style_for(
            node,
            &declarations,
            true,
            &context.display,
            &context.fonts,
            self.work,
        )?;
        style.border = context.borders.geometry()?;
        self.boxes
            .new_leaf(style)
            .map(Some)
            .map_err(|error| layout_error(&error))
    }
    fn rect(&self, target: NodeRef<'_>) -> Result<Bounds> {
        let Some(id) = self.ids.get(&target.id) else {
            return Ok(Bounds::default());
        };
        self.visual(*id).map(|frame| frame.bounds)
    }
    fn build(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        parent: &Variables,
        parent_display: Display,
        context: &BoxContext,
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
        if [
            "head", "script", "style", "link", "meta", "title", "noscript",
        ]
        .iter()
        .any(|name| node.has_name(name))
        {
            return Ok(());
        }
        let declarations = if let Some(state) = self.styles.get(&node.id) {
            state.clone()
        } else {
            Declarations::parse(node.attr("style").as_deref().unwrap_or_default())
                .map_err(|message| Error::Dom(message.into()))?
        };
        let declarations =
            self.cascade
                .resolve(node, &declarations, None, self.containers, self.work)?;
        let (declarations, variables) =
            declarations.compute_registered(parent, &self.cascade.registrations, self.work)?;
        let declarations = self
            .cascade
            .animations
            .sample(&declarations, &variables, self.work)?;
        let declarations = self
            .transitions
            .borrow_mut()
            .sample(node, declarations, self.now)?;
        let display = context
            .display
            .compute(node, &declarations, depth == 0, false)?;
        if display.none() {
            return Ok(());
        }
        crate::html_boxes::validate(node)?;
        if display.contents() {
            let context = context.compute(&declarations, false, display, self.work)?;
            return self.children(node, depth, &variables, parent_display, &context, output);
        }
        let context = context.compute(&declarations, depth == 0, display, self.work)?;
        let mut style = style_for(
            node,
            &declarations,
            false,
            &context.display,
            &context.fonts,
            self.work,
        )?;
        style.border = context.borders.geometry()?;
        let fonts = context.fonts;
        let container =
            crate::containers::Container::apply(&declarations, &mut style, parent_display, fonts)?;
        let (position, _) = declarations.value("position");
        let position = defaulted("position", &position);
        let out_of_flow = style.position == Position::Absolute;
        let containing = if out_of_flow && position != "fixed" {
            node.ancestors_it(None)
                .find(|ancestor| self.positioned.contains(&ancestor.id))
                .map(|ancestor| ancestor.id)
        } else {
            None
        };
        // display:contents contributes no box; size containers alone do not
        // establish positioning containing blocks in CSS Conditional Rules 5.
        if matches!(position, "relative" | "absolute" | "fixed" | "sticky") {
            self.positioned.insert(node.id);
        }
        let mut children = Vec::new();
        self.children(
            node,
            depth,
            &variables,
            style.display,
            &context,
            &mut children,
        )?;
        let id = self
            .boxes
            .new_with_children(style, &children)
            .map_err(|error| layout_error(&error))?;
        self.record_box(node.id, id, position, &declarations, &fonts)?;
        if out_of_flow {
            self.out_of_flow.push((id, containing));
        }
        if let Some(container) = container {
            self.next_containers.insert(node.id, container);
        }
        output.push(id);
        Ok(())
    }
    fn record_box(
        &mut self,
        node: NodeId,
        id: taffy::NodeId,
        position: &str,
        declarations: &Declarations,
        fonts: &crate::fonts::Context,
    ) -> Result<()> {
        self.ids.insert(node, id);
        self.box_nodes.insert(id, node);
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
    fn children(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        variables: &Variables,
        parent_display: Display,
        context: &BoxContext,
        output: &mut Vec<taffy::NodeId>,
    ) -> Result<()> {
        if let Some(before) = self.generated(
            node,
            crate::cascade::Generated::Before,
            variables,
            parent_display,
            depth.saturating_add(1),
            context,
        )? {
            output.push(before);
        }
        for child in node.children_it(false) {
            self.build(
                child,
                depth.saturating_add(1),
                variables,
                parent_display,
                context,
                output,
            )?;
        }
        if let Some(after) = self.generated(
            node,
            crate::cascade::Generated::After,
            variables,
            parent_display,
            depth.saturating_add(1),
            context,
        )? {
            output.push(after);
        }
        Ok(())
    }
}

pub(crate) struct Sources<'a> {
    pub scroll: &'a ScrollState,
    pub transitions: &'a std::cell::RefCell<crate::transitions::State>,
    pub now: f64,
    pub inline: &'a HashMap<NodeId, Declarations>,
    pub external: &'a crate::stylesheets::Sheets,
    pub constructed: &'a crate::cssom::Arena,
    pub base: Option<&'a str>,
}

pub(crate) fn bounds(
    document: &Document,
    target: NodeRef<'_>,
    styles: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Bounds> {
    if !target.is_element() {
        return Err(unsupported("non-element owner"));
    }
    if !target
        .ancestors_it(None)
        .any(|ancestor| ancestor.is_document())
    {
        return Ok(Bounds::default());
    }
    scene(document, styles, media, work, |tree| tree.rect(target))
}

fn scene<T>(
    document: &Document,
    styles: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
    measure: impl FnOnce(&mut Tree<'_, '_>) -> Result<T>,
) -> Result<T> {
    let cascade = crate::cascade::Cascade::collect(
        document,
        styles.external,
        styles.constructed,
        styles.base,
        media,
        work,
    )?;
    let root = document
        .root()
        .children_it(false)
        .find(NodeRef::is_element)
        .ok_or_else(|| unsupported("document root"))?;
    let width = f32::from(u16::try_from(media.width).map_err(|_error| unsupported("viewport"))?);
    let height = f32::from(u16::try_from(media.height).map_err(|_error| unsupported("viewport"))?);
    let mut containers = crate::containers::Snapshot::new();
    for _round in 0..=32 {
        let mut tree = Tree {
            boxes: TaffyTree::new(),
            ids: HashMap::new(),
            positioned: HashSet::new(),
            fixed: HashSet::new(),
            out_of_flow: Vec::new(),
            box_nodes: HashMap::new(),
            sticky: HashMap::new(),
            scroll: styles.scroll,
            transitions: styles.transitions,
            now: styles.now,
            viewport: Size {
                width: f64::from(width),
                height: f64::from(height),
            },
            styles: styles.inline,
            visited: 0,
            cascade: &cascade,
            containers: &containers,
            next_containers: crate::containers::Snapshot::new(),
            work,
        };
        tree.boxes.disable_rounding();
        let mut root_ids = Vec::new();
        tree.build(
            root,
            0,
            &Variables::default(),
            Display::Block,
            &BoxContext {
                fonts: crate::fonts::Context::new(media),
                borders: crate::borders::Borders::default(),
                outlines: crate::outlines::Outlines::default(),
                images: crate::backgrounds::Images::default(),
                positions: crate::background_position::Positions::default(),
                repeats: crate::background_repeat::Repeats::default(),
                sizes: crate::background_size::Sizes::default(),
                layers: crate::background_layers::Layers::default(),
                family: crate::font_family::Family::default(),
                display: crate::display::Computed::default(),
            },
            &mut root_ids,
        )?;
        if let Some(root_id) = root_ids.first().copied() {
            let root_id = tree.position_boxes(root_id, width, height)?;
            tree.boxes
                .compute_layout(
                    root_id,
                    Size {
                        width: AvailableSpace::Definite(width),
                        height: AvailableSpace::Definite(height),
                    },
                )
                .map_err(|error| layout_error(&error))?;
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
pub(crate) use intersection::{Margins, Observation};

pub(crate) fn observe(
    document: &Document,
    target: NodeRef<'_>,
    root: Option<NodeRef<'_>>,
    margins: &Margins,
    styles: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Observation> {
    scene(document, styles, media, work, |tree| {
        intersection::observe(tree, target, root, margins, media)
    })
}

mod geometry;
pub(crate) use geometry::{ScrollState, measurement};
