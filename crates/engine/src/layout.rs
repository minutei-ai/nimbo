use std::collections::HashMap;

use dom_query::{Document, NodeId, NodeRef};
use serde::Serialize;
use taffy::{Overflow, TaffyError, prelude::*};

use crate::{
    Error, MediaEnvironment, Result,
    styles::{Declarations, Variables},
};

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

fn blockified<'a>(name: &str, value: &'a str, blockify: bool) -> &'a str {
    let value = defaulted(name, value);
    if !blockify || name != "display" {
        return value;
    }
    match value {
        "inline" | "inline-block" => "block",
        "inline-flex" => "flex",
        "inline-grid" => "grid",
        _ => value,
    }
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
    style_for(node, declarations, false, false)
}

fn non_layout(name: &str) -> bool {
    crate::background_layers::property(name)
        || matches!(
            name,
            "color"
                | "background-color"
                | "background-image"
                | "background-position-x"
                | "background-position-y"
                | "background-repeat"
                | "background-size"
                | "opacity"
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
    blockify: bool,
) -> Result<Style> {
    let mut style = initial_style(node, generated)?;
    macro_rules! assign {
        ($field:expr, $value:expr, $name:expr) => {{
            let value = if $value == "0" && !matches!($name, "flex-grow" | "flex-shrink") {
                "0px"
            } else {
                $value
            };
            $field = value.parse().map_err(|_error| unsupported($name))?;
        }};
    }
    for (name, value, deferred) in logical::entries(declarations) {
        if generated && name == "content" {
            continue;
        }
        let value = blockified(name, value, generated && blockify);
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
            "display" => assign!(style.display, value, name),
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
            "position" if matches!(value, "static" | "relative") => {}
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
            _ => return Err(unsupported(name)),
        }
    }
    if !generated {
        validate_overflow(node, &style)?;
    }
    // Static positioning ignores inset properties. Taffy represents static and
    // relative boxes with the same positioning enum, so clear the insets here.
    if !declarations
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

fn validate_element(node: NodeRef<'_>) -> Result<()> {
    if ![
        "html", "body", "div", "main", "section", "article", "aside", "header", "footer", "nav",
    ]
    .iter()
    .any(|name| node.has_name(name))
        || node
            .qual_name_ref()
            .is_none_or(|name| name.ns.as_ref() != "http://www.w3.org/1999/xhtml")
    {
        return Err(unsupported("element formatting"));
    }
    Ok(())
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
}

impl BoxContext {
    fn compute(
        &self,
        declarations: &Declarations,
        root: bool,
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
        })
    }
}

struct Tree<'a, 'b> {
    boxes: TaffyTree<()>,
    ids: HashMap<NodeId, taffy::NodeId>,
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
        let mut style = style_for(
            node,
            &declarations,
            true,
            matches!(parent_display, Display::Flex | Display::Grid),
        )?;
        let context = context.compute(&declarations, false, self.work)?;
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
        let measured = self
            .boxes
            .layout(*id)
            .map_err(|error| layout_error(&error))?;
        let mut result = Bounds {
            width: f64::from(measured.size.width),
            height: f64::from(measured.size.height),
            ..Bounds::default()
        };
        for node in std::iter::once(target).chain(target.ancestors_it(None)) {
            if let Some(id) = self.ids.get(&node.id) {
                let measured = self
                    .boxes
                    .layout(*id)
                    .map_err(|error| layout_error(&error))?;
                result.x += f64::from(measured.location.x);
                result.y += f64::from(measured.location.y);
            }
        }
        if ![result.x, result.y, result.width, result.height]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err(unsupported("non-finite geometry"));
        }
        Ok(result)
    }
    fn build(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        parent: &Variables,
        parent_display: Display,
        context: &BoxContext,
    ) -> Result<Option<taffy::NodeId>> {
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
            return Ok(None);
        }
        if ["head", "script", "style", "link", "meta", "title"]
            .iter()
            .any(|name| node.has_name(name))
        {
            return Ok(None);
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
        let mut style = style(node, &declarations)?;
        if style.display == Display::None {
            return Ok(None);
        }
        let context = context.compute(&declarations, depth == 0, self.work)?;
        style.border = context.borders.geometry()?;
        let fonts = context.fonts;
        let container =
            crate::containers::Container::apply(&declarations, &mut style, parent_display, fonts)?;
        validate_element(node)?;
        let mut children = Vec::new();
        if let Some(before) = self.generated(
            node,
            crate::cascade::Generated::Before,
            &variables,
            style.display,
            depth.saturating_add(1),
            &context,
        )? {
            children.push(before);
        }
        children.extend(
            node.children_it(false)
                .filter_map(|child| {
                    self.build(
                        child,
                        depth.saturating_add(1),
                        &variables,
                        style.display,
                        &context,
                    )
                    .transpose()
                })
                .collect::<Result<Vec<_>>>()?,
        );
        if let Some(after) = self.generated(
            node,
            crate::cascade::Generated::After,
            &variables,
            style.display,
            depth.saturating_add(1),
            &context,
        )? {
            children.push(after);
        }
        let id = self
            .boxes
            .new_with_children(style, &children)
            .map_err(|error| layout_error(&error))?;
        self.ids.insert(node.id, id);
        if let Some(container) = container {
            self.next_containers.insert(node.id, container);
        }
        Ok(Some(id))
    }
}

pub(crate) struct Sources<'a> {
    pub inline: &'a HashMap<NodeId, Declarations>,
    pub external: &'a crate::stylesheets::Sheets,
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
    let cascade =
        crate::cascade::Cascade::collect(document, styles.external, styles.base, media, work)?;
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
            styles: styles.inline,
            visited: 0,
            cascade: &cascade,
            containers: &containers,
            next_containers: crate::containers::Snapshot::new(),
            work,
        };
        tree.boxes.disable_rounding();
        let root_id = tree.build(
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
            },
        )?;
        if let Some(root_id) = root_id {
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
