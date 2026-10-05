//! Coupled box geometry and synchronous element scrolling. No JS-side geometry state.
use dom_query::{Document, NodeId, NodeRef};
use serde_json::{Value, json};
use taffy::{Overflow, Point, prelude::*, style::ExpandedLengthPercentageAuto};

use super::{Bounds, Sources, Tree, Work, layout_error, scene, unsupported};
use crate::{MediaEnvironment, Result, styles::Declarations};

pub(crate) type ScrollState = std::collections::HashMap<NodeId, Point<f64>>;

pub(super) struct Frame {
    pub bounds: Bounds,
    scroll: Point<f64>,
}

pub(super) fn insets(
    declarations: &Declarations,
    fonts: &crate::fonts::Context,
    work: &mut Work<'_>,
) -> Result<Rect<LengthPercentageAuto>> {
    let mut result = Rect::auto();
    for (name, value, _) in super::logical::entries(declarations) {
        let slot = match name {
            "top" => &mut result.top,
            "right" => &mut result.right,
            "bottom" => &mut result.bottom,
            "left" => &mut result.left,
            _ => continue,
        };
        let value = super::defaulted(name, value);
        *slot = super::lengths::value(name, value, fonts, work)?
            .parse()
            .map_err(|_error| unsupported("sticky inset"))?;
    }
    Ok(result)
}

fn resolve(value: LengthPercentageAuto, basis: f64) -> Result<Option<f64>> {
    let result = match value.expand() {
        ExpandedLengthPercentageAuto::Auto => return Ok(None),
        ExpandedLengthPercentageAuto::Length(value) => f64::from(value),
        ExpandedLengthPercentageAuto::Percent(value) => f64::from(value) * basis,
    };
    if !result.is_finite() {
        return Err(unsupported("non-finite sticky inset"));
    }
    Ok(Some(result))
}

// Shift only in the direction requested by a non-auto inset. A sticky box
// retains its normal-flow space and cannot cross its containing-block edge.
fn axis(
    normal: f64,
    size: f64,
    port: (f64, f64),
    containing: (f64, f64),
    margin: (f64, f64),
    inset: (Option<f64>, Option<f64>),
) -> f64 {
    let start = inset.0.unwrap_or(0.0);
    let end = inset.1.unwrap_or(0.0).min(port.1 - start - size);
    let min = containing.0 + margin.0.min(normal - containing.0);
    let max = containing.0 + containing.1
        - size
        - margin.1.min(containing.0 + containing.1 - normal - size);
    let mut value = normal;
    if inset.0.is_some() && value < port.0 + start {
        value = (port.0 + start).min(max).max(normal);
    }
    if inset.1.is_some() && value + size > port.0 + port.1 - end {
        value = (port.0 + port.1 - end - size).max(min).min(value);
    }
    value
}

impl Tree<'_, '_> {
    fn measured(&self, id: taffy::NodeId) -> Result<&Layout> {
        self.boxes.layout(id).map_err(|error| layout_error(&error))
    }
    fn maximum(&self, id: taffy::NodeId) -> Result<Point<f64>> {
        let layout = self.measured(id)?;
        let style = self.boxes.style(id).map_err(|error| layout_error(&error))?;
        Ok(Point {
            x: if style.overflow.x == Overflow::Hidden {
                f64::from(layout.scroll_width())
            } else {
                0.0
            },
            y: if style.overflow.y == Overflow::Hidden {
                f64::from(layout.scroll_height())
            } else {
                0.0
            },
        })
    }
    fn scroll_offset(&self, id: taffy::NodeId) -> Result<Point<f64>> {
        let maximum = self.maximum(id)?;
        let requested = self
            .box_nodes
            .get(&id)
            .and_then(|node| self.scroll.get(node));
        let requested = requested.copied().unwrap_or(Point { x: 0.0, y: 0.0 });
        Ok(Point {
            x: requested.x.clamp(0.0, maximum.x),
            y: requested.y.clamp(0.0, maximum.y),
        })
    }
    pub(super) fn visual(&self, target: taffy::NodeId) -> Result<Frame> {
        let mut chain = vec![target];
        let mut current = target;
        while let Some(parent) = self.boxes.parent(current) {
            chain.push(parent);
            current = parent;
        }
        let mut frames: Vec<(taffy::NodeId, Frame)> = Vec::with_capacity(chain.len());
        for id in chain.into_iter().rev() {
            let layout = self.measured(id)?;
            let mut frame = Frame {
                bounds: Bounds {
                    x: f64::from(layout.location.x),
                    y: f64::from(layout.location.y),
                    width: f64::from(layout.size.width),
                    height: f64::from(layout.size.height),
                },
                scroll: Point { x: 0.0, y: 0.0 },
            };
            if let Some((parent, previous)) = frames.last() {
                let offset = self.scroll_offset(*parent)?;
                frame.bounds.x += previous.bounds.x - offset.x;
                frame.bounds.y += previous.bounds.y - offset.y;
                frame.scroll = Point {
                    x: previous.scroll.x + offset.x,
                    y: previous.scroll.y + offset.y,
                };
                if let Some(inset) = self.sticky.get(&id) {
                    self.stick(&mut frame.bounds, inset, layout, &frames)?;
                }
            }
            frames.push((id, frame));
        }
        let (_, frame) = frames.pop().ok_or_else(|| unsupported("missing box"))?;
        if ![
            frame.bounds.x,
            frame.bounds.y,
            frame.bounds.width,
            frame.bounds.height,
        ]
        .iter()
        .all(|value| value.is_finite())
        {
            return Err(unsupported("non-finite geometry"));
        }
        Ok(frame)
    }
    fn stick(
        &self,
        rect: &mut Bounds,
        inset: &Rect<LengthPercentageAuto>,
        layout: &Layout,
        ancestors: &[(taffy::NodeId, Frame)],
    ) -> Result<()> {
        let (parent, frame) = ancestors
            .last()
            .ok_or_else(|| unsupported("sticky containing block"))?;
        let parent = self.measured(*parent)?;
        let containing = Bounds {
            x: frame.bounds.x + f64::from(parent.border.left + parent.padding.left),
            y: frame.bounds.y + f64::from(parent.border.top + parent.padding.top),
            width: f64::from(parent.content_box_width()),
            height: f64::from(parent.content_box_height()),
        };
        let mut port = Bounds {
            width: self.viewport.width,
            height: self.viewport.height,
            ..Bounds::default()
        };
        for (id, ancestor) in ancestors.iter().rev() {
            let style = self
                .boxes
                .style(*id)
                .map_err(|error| layout_error(&error))?;
            if style.overflow.x == Overflow::Hidden || style.overflow.y == Overflow::Hidden {
                let layout = self.measured(*id)?;
                port = Bounds {
                    x: ancestor.bounds.x + f64::from(layout.border.left + layout.padding.left),
                    y: ancestor.bounds.y + f64::from(layout.border.top + layout.padding.top),
                    width: f64::from(layout.content_box_width()),
                    height: f64::from(layout.content_box_height()),
                };
                break;
            }
        }
        rect.x = axis(
            rect.x,
            rect.width,
            (port.x, port.width),
            (containing.x, containing.width),
            (
                f64::from(layout.margin.left),
                f64::from(layout.margin.right),
            ),
            (
                resolve(inset.left, port.width)?,
                resolve(inset.right, port.width)?,
            ),
        );
        rect.y = axis(
            rect.y,
            rect.height,
            (port.y, port.height),
            (containing.y, containing.height),
            (
                f64::from(layout.margin.top),
                f64::from(layout.margin.bottom),
            ),
            (
                resolve(inset.top, port.height)?,
                resolve(inset.bottom, port.height)?,
            ),
        );
        Ok(())
    }
}

pub(crate) struct Measurement {
    pub values: Value,
    pub parent: Option<NodeId>,
    pub scroll: Point<f64>,
    pub maximum: Point<f64>,
}

pub(crate) fn measurement(
    document: &Document,
    target: NodeRef<'_>,
    styles: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Measurement> {
    super::svg_viewport::geometry(target)?;
    scene(document, styles, media, work, |tree| measure(tree, target))
}

fn measure(tree: &Tree<'_, '_>, target: NodeRef<'_>) -> Result<Measurement> {
    let mut values = json!({ "offsetTop":0,"offsetLeft":0,"offsetWidth":0,"offsetHeight":0,
        "clientTop":0,"clientLeft":0,"clientWidth":0,"clientHeight":0,
        "scrollWidth":0,"scrollHeight":0,"scrollTop":0,"scrollLeft":0 });
    let Some(id) = tree.ids.get(&target.id) else {
        return Ok(Measurement {
            values,
            parent: None,
            scroll: Point { x: 0.0, y: 0.0 },
            maximum: Point { x: 0.0, y: 0.0 },
        });
    };
    let layout = tree.measured(*id)?;
    let frame = tree.visual(*id)?;
    let parent = if target.has_name("body") || tree.fixed.contains(&target.id) {
        None
    } else {
        target
            .ancestors_it(None)
            .find(|node| {
                tree.ids.contains_key(&node.id)
                    && (tree.positioned.contains(&node.id) || node.has_name("body"))
            })
            .map(|node| node.id)
    };
    let origin = if let Some(node) = parent {
        let id = tree
            .ids
            .get(&node)
            .ok_or_else(|| unsupported("offset parent"))?;
        let frame = tree.visual(*id)?;
        let layout = tree.measured(*id)?;
        Point {
            x: frame.bounds.x + frame.scroll.x + f64::from(layout.border.left),
            y: frame.bounds.y + frame.scroll.y + f64::from(layout.border.top),
        }
    } else {
        Point { x: 0.0, y: 0.0 }
    };
    let client = Point {
        x: f64::from(layout.size.width - layout.border.left - layout.border.right),
        y: f64::from(layout.size.height - layout.border.top - layout.border.bottom),
    };
    let scroll = tree.scroll_offset(*id)?;
    let object = values
        .as_object_mut()
        .ok_or_else(|| unsupported("geometry result"))?;
    for (name, value) in [
        (
            "offsetTop",
            if target.has_name("body") {
                0.0
            } else {
                frame.bounds.y + frame.scroll.y - origin.y
            },
        ),
        (
            "offsetLeft",
            if target.has_name("body") {
                0.0
            } else {
                frame.bounds.x + frame.scroll.x - origin.x
            },
        ),
        ("offsetWidth", frame.bounds.width),
        ("offsetHeight", frame.bounds.height),
        ("clientTop", f64::from(layout.border.top)),
        ("clientLeft", f64::from(layout.border.left)),
        ("clientWidth", client.x),
        ("clientHeight", client.y),
        ("scrollWidth", client.x + f64::from(layout.scroll_width())),
        ("scrollHeight", client.y + f64::from(layout.scroll_height())),
    ] {
        object.insert(name.into(), json!(value.round()));
    }
    object.insert("scrollTop".into(), json!(scroll.y));
    object.insert("scrollLeft".into(), json!(scroll.x));
    Ok(Measurement {
        values,
        parent,
        scroll,
        maximum: tree.maximum(*id)?,
    })
}
