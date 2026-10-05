use cssparser::{Parser, ParserInput, Token};
use dom_query::NodeRef;
use serde::{Deserialize, Serialize};
use taffy::Overflow;

use super::{Bounds, Work, geometry::View, unsupported};
use crate::{Error, MediaEnvironment, Result};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Margin {
    value: f32,
    percent: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Margins {
    values: [Margin; 4],
    css: String,
}

fn syntax() -> Error {
    Error::DomException {
        name: "SyntaxError",
        message: "invalid intersection margin",
    }
}

impl Margins {
    pub(crate) fn parse(source: &str) -> Result<Self> {
        if source.len() > 1024 {
            return Err(Error::Limit("intersection margin bytes"));
        }
        let mut input = ParserInput::new(source);
        let mut parser = Parser::new(&mut input);
        let mut values = Vec::new();
        while !parser.is_exhausted() {
            if values.len() >= 4 {
                return Err(syntax());
            }
            let margin = match parser.next().map_err(|_error| syntax())?.clone() {
                Token::Dimension { value, unit, .. } => {
                    let scale = match unit.to_ascii_lowercase().as_str() {
                        "px" => 1.0,
                        "in" => 96.0,
                        "cm" => 96.0 / 2.54,
                        "mm" => 96.0 / 25.4,
                        "q" => 96.0 / 101.6,
                        "pt" => 96.0 / 72.0,
                        "pc" => 16.0,
                        _ => return Err(syntax()),
                    };
                    Margin {
                        value: value * scale,
                        percent: false,
                    }
                }
                Token::Percentage { unit_value, .. } => Margin {
                    value: unit_value * 100.0,
                    percent: true,
                },
                _ => return Err(syntax()),
            };
            if !margin.value.is_finite() {
                return Err(syntax());
            }
            values.push(margin);
        }
        if values.is_empty() {
            values.push(Margin {
                value: 0.0,
                percent: false,
            });
        }
        let top = *values.first().ok_or_else(syntax)?;
        let right = *values.get(1).unwrap_or(&top);
        let bottom = *values.get(2).unwrap_or(&top);
        let left = *values.get(3).unwrap_or(&right);
        let values = [top, right, bottom, left];
        let css = values
            .iter()
            .map(|margin| {
                format!(
                    "{}{}",
                    margin.value,
                    if margin.percent { "%" } else { "px" }
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        Ok(Self { values, css })
    }
    fn expand(&self, rect: &Bounds) -> Result<Bounds> {
        let offsets = self.values.map(|margin| {
            let value = f64::from(margin.value);
            if margin.percent {
                rect.width * value / 100.0
            } else {
                value
            }
        });
        if !offsets.iter().all(|value| value.is_finite()) {
            return Err(unsupported("intersection margin"));
        }
        let [top, right, bottom, left] = offsets;
        let result = Bounds {
            x: rect.x - left,
            y: rect.y - top,
            width: rect.width + left + right,
            height: rect.height + top + bottom,
        };
        if result.width < 0.0 || result.height < 0.0 {
            return Err(unsupported("overconstrained intersection margin"));
        }
        Ok(result)
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Observation {
    root_bounds: Bounds,
    bounding_client_rect: Bounds,
    intersection_rect: Bounds,
    is_intersecting: bool,
    intersection_ratio: f64,
}

fn clip(mut rect: Bounds, limit: &Bounds, x: bool, y: bool) -> Option<Bounds> {
    if x {
        let left = rect.x.max(limit.x);
        let right = (rect.x + rect.width).min(limit.x + limit.width);
        if right < left {
            return None;
        }
        rect.x = left;
        rect.width = right - left;
    }
    if y {
        let top = rect.y.max(limit.y);
        let bottom = (rect.y + rect.height).min(limit.y + limit.height);
        if bottom < top {
            return None;
        }
        rect.y = top;
        rect.height = bottom - top;
    }
    Some(rect)
}

pub(super) fn observe(
    tree: &View<'_>,
    target: NodeRef<'_>,
    root: Option<NodeRef<'_>>,
    margins: &Margins,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Observation> {
    if !target.is_element() {
        return Err(unsupported("intersection target"));
    }
    let root_rect = root.map_or_else(
        || {
            Ok(Bounds {
                width: f64::from(media.width),
                height: f64::from(media.height),
                ..Bounds::default()
            })
        },
        |root| tree.rect(root),
    )?;
    let root_bounds = margins.expand(&root_rect)?;
    let belongs = root.is_none_or(|root| {
        target
            .ancestors_it(None)
            .any(|ancestor| ancestor.id == root.id)
    });
    let present = belongs
        && tree.ids.contains_key(&target.id)
        && root.is_none_or(|root| tree.ids.contains_key(&root.id));
    let bounding_client_rect = if present {
        tree.rect(target)?
    } else {
        Bounds::default()
    };
    let mut intersection = present.then(|| bounding_client_rect.clone());
    let root_id = root.and_then(|root| tree.ids.get(&root.id)).copied();
    let mut ancestor = tree
        .ids
        .get(&target.id)
        .and_then(|id| tree.boxes.parent(*id));
    let mut reached_root = root.is_none();
    while let Some(id) = ancestor {
        work.charge()?;
        if Some(id) == root_id {
            reached_root = true;
            break;
        }
        ancestor = tree.boxes.parent(id);
        let style = tree
            .boxes
            .style(id)
            .map_err(|error| super::layout_error(&error))?;
        let x = style.overflow.x != Overflow::Visible;
        let y = style.overflow.y != Overflow::Visible;
        if x || y {
            let bounds = tree.native_rect(id)?;
            intersection = intersection.and_then(|rect| clip(rect, &bounds, x, y));
        }
    }
    if !reached_root {
        return Ok(Observation::default());
    }
    for ancestor in target.ancestors_it(None) {
        work.charge()?;
        if root.is_some_and(|root| root.id == ancestor.id) {
            break;
        }
        if let Some(id) = tree.ids.get(&ancestor.id)
            && let Some(path) = tree.clips.get(id)
        {
            let bounds = path.bounds(&tree.native_rect(*id)?, work)?;
            intersection = intersection.and_then(|rect| clip(rect, &bounds, true, true));
        }
    }
    intersection = intersection.and_then(|rect| clip(rect, &root_bounds, true, true));
    let is_intersecting = intersection.is_some();
    let intersection_rect = intersection.unwrap_or_default();
    let target_area = bounding_client_rect.width * bounding_client_rect.height;
    let intersection_ratio = if target_area == 0.0 {
        if is_intersecting { 1.0 } else { 0.0 }
    } else {
        intersection_rect.width * intersection_rect.height / target_area
    };
    Ok(Observation {
        root_bounds,
        bounding_client_rect,
        intersection_rect,
        is_intersecting,
        intersection_ratio,
    })
}
