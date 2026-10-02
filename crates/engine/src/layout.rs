use std::collections::HashMap;

use dom_query::{Document, NodeId, NodeRef};
use serde::Serialize;
use taffy::{Overflow, TaffyError, prelude::*};

use crate::{
    Error, MediaEnvironment, Result,
    styles::{Declarations, Variables},
};

pub(crate) struct Work<'a> {
    operations: &'a mut usize,
    limit: usize,
}
impl<'a> Work<'a> {
    pub(crate) fn new(operations: &'a mut usize, limit: usize) -> Self {
        Self { operations, limit }
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
    if matches!(value, "initial" | "unset") {
        match name {
            "width" | "height" | "min-width" | "min-height" | "flex-basis" | "left" | "right"
            | "top" | "bottom" | "align-self" => "auto",
            "max-width" | "max-height" => "none",
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

fn initial_style(node: NodeRef<'_>) -> Style {
    let mut style = Style {
        display: Display::Block,
        box_sizing: BoxSizing::ContentBox,
        ..Style::default()
    };
    if node.has_name("body") {
        style.margin = Rect::length(8.0);
    }
    if node.has_attr("hidden") {
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

fn style(node: NodeRef<'_>, declarations: &Declarations) -> Result<Style> {
    if node
        .attr("dir")
        .is_some_and(|value| value.eq_ignore_ascii_case("rtl"))
    {
        return Err(unsupported("direction"));
    }
    let mut style = initial_style(node);
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
    for (name, value, deferred) in declarations.layout_entries() {
        let value = defaulted(name, value);
        if name == "visibility" && (deferred || value == "collapse") {
            return Err(unsupported("visibility"));
        }
        if name.starts_with("--")
            || matches!(
                name,
                "color" | "background-color" | "opacity" | "visibility"
            )
        {
            continue;
        }
        if deferred {
            return Err(unsupported("variable substitution"));
        }
        match name {
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
    validate_overflow(node, &style)?;
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

struct Tree<'a, 'b> {
    boxes: TaffyTree<()>,
    ids: HashMap<NodeId, taffy::NodeId>,
    styles: &'a HashMap<NodeId, Declarations>,
    visited: usize,
    cascade: &'a crate::cascade::Cascade,
    work: &'a mut Work<'b>,
}

impl Tree<'_, '_> {
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
    ) -> Result<Option<taffy::NodeId>> {
        self.work.charge()?;
        self.visited = self.visited.saturating_add(1);
        if self.visited > 1024 || depth > 128 {
            return Err(Error::Limit("layout tree"));
        }
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
        let declarations = self.cascade.resolve(node, &declarations, self.work)?;
        let (declarations, variables) = declarations.compute_variables(parent, self.work)?;
        let style = style(node, &declarations)?;
        if style.display == Display::None {
            return Ok(None);
        }
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
        let children = node
            .children_it(false)
            .filter_map(|child| {
                self.build(child, depth.saturating_add(1), &variables)
                    .transpose()
            })
            .collect::<Result<Vec<_>>>()?;
        let id = self
            .boxes
            .new_with_children(style, &children)
            .map_err(|error| layout_error(&error))?;
        self.ids.insert(node.id, id);
        Ok(Some(id))
    }
}

pub(crate) fn bounds(
    document: &Document,
    target: NodeRef<'_>,
    styles: &HashMap<NodeId, Declarations>,
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
    styles: &HashMap<NodeId, Declarations>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
    measure: impl FnOnce(&mut Tree<'_, '_>) -> Result<T>,
) -> Result<T> {
    let cascade = crate::cascade::Cascade::collect(document, media, work)?;
    let root = document
        .root()
        .children_it(false)
        .find(NodeRef::is_element)
        .ok_or_else(|| unsupported("document root"))?;
    let mut tree = Tree {
        boxes: TaffyTree::new(),
        ids: HashMap::new(),
        styles,
        visited: 0,
        cascade: &cascade,
        work,
    };
    tree.boxes.disable_rounding();
    let root_id = tree.build(root, 0, &Variables::default())?;
    let width = f32::from(u16::try_from(media.width).map_err(|_error| unsupported("viewport"))?);
    let height = f32::from(u16::try_from(media.height).map_err(|_error| unsupported("viewport"))?);
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
    measure(&mut tree)
}

mod intersection;
pub(crate) use intersection::{Margins, Observation};

pub(crate) fn observe(
    document: &Document,
    target: NodeRef<'_>,
    root: Option<NodeRef<'_>>,
    margins: &Margins,
    styles: &HashMap<NodeId, Declarations>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Observation> {
    scene(document, styles, media, work, |tree| {
        intersection::observe(tree, target, root, margins, media)
    })
}
