//! Shared intrinsic sizing for native replaced boxes.
use super::unsupported;
use crate::{Result, dom_attributes::NativeAttributes};
use dom_query::NodeRef;
use num_traits::ToPrimitive;
use taffy::prelude::*;

#[derive(Clone, Copy)]
pub(super) struct Intrinsic {
    pub(super) width: Option<f32>,
    pub(super) height: Option<f32>,
    pub(super) ratio: Option<f32>,
}

impl Intrinsic {
    pub(super) fn layout(&self, inputs: taffy::LayoutInput, style: &Style) -> taffy::LayoutOutput {
        let (content, inset) = self.used_size(inputs, style);
        let adjustment = if style.box_sizing == BoxSizing::BorderBox {
            inset
        } else {
            Size::ZERO
        };
        let style = Style {
            size: Size {
                width: Dimension::length(content.width + adjustment.width),
                height: Dimension::length(content.height + adjustment.height),
            },
            aspect_ratio: None,
            ..style.clone()
        };
        taffy::compute_leaf_layout(inputs, &style, |_, _| 0.0, |_, _| content)
    }

    fn used_size(&self, inputs: taffy::LayoutInput, style: &Style) -> (Size<f32>, Size<f32>) {
        use taffy::util::{MaybeResolve, ResolveOrZero};
        let padding = style
            .padding
            .resolve_or_zero(inputs.parent_size.width, |_, _| 0.0)
            .sum_axes();
        let border = style
            .border
            .resolve_or_zero(inputs.parent_size.width, |_, _| 0.0)
            .sum_axes();
        let inset = Size {
            width: padding.width + border.width,
            height: padding.height + border.height,
        };
        let adjust = if style.box_sizing == BoxSizing::BorderBox {
            inset
        } else {
            Size::ZERO
        };
        let declared = style
            .size
            .maybe_resolve(inputs.parent_size, |_, _| 0.0)
            .zip_map(adjust, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            });
        let known = inputs
            .known_dimensions
            .zip_map(inset, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            })
            .or(declared);
        let min = style
            .min_size
            .maybe_resolve(inputs.parent_size, |_, _| 0.0)
            .zip_map(adjust, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            });
        let max = style
            .max_size
            .maybe_resolve(inputs.parent_size, |_, _| 0.0)
            .zip_map(adjust, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            });
        let available = inputs.available_space.zip_map(inset, |space, inset| {
            space.map_definite_value(|value| (value - inset).max(0.0))
        });
        let size = self.measure(known, available);
        (self.constrain(size, known, min, max), inset)
    }

    fn constrain(
        &self,
        size: Size<f32>,
        known: Size<Option<f32>>,
        min: Size<Option<f32>>,
        max: Size<Option<f32>>,
    ) -> Size<f32> {
        let min = min.map(|value| value.unwrap_or(0.0));
        let max = max.zip_map(min, |value, min| value.unwrap_or(f32::INFINITY).max(min));
        let clamped = size.zip_map(min, f32::max).zip_map(max, f32::min);
        let Some(ratio) = self.ratio else {
            return clamped;
        };
        match (known.width, known.height) {
            (Some(_), None) => Size {
                width: clamped.width,
                height: (clamped.width / ratio).clamp(min.height, max.height),
            },
            (None, Some(_)) => Size {
                width: (clamped.height * ratio).clamp(min.width, max.width),
                height: clamped.height,
            },
            (None, None) if size.width > 0.0 && size.height > 0.0 => {
                let minimum = (min.width / size.width).max(min.height / size.height);
                let maximum = (max.width / size.width).min(max.height / size.height);
                if minimum <= maximum {
                    let scale = 1.0_f32.clamp(minimum, maximum);
                    return size.map(|value| value * scale);
                }
                if min.width / size.width > max.height / size.height {
                    Size {
                        width: min.width,
                        height: max.height,
                    }
                } else {
                    Size {
                        width: max.width,
                        height: min.height,
                    }
                }
            }
            (Some(_), Some(_)) | (None, None) => clamped,
        }
    }

    pub(super) fn canvas(node: NodeRef<'_>, style: &mut Style) -> Result<Option<Self>> {
        fn dimension(node: NodeRef<'_>, name: &str, fallback: u32) -> u32 {
            let Some(value) = node.null_attribute(name) else {
                return fallback;
            };
            let value = value.trim_start_matches([' ', '\t', '\n', '\r', '\u{c}']);
            let value = value.strip_prefix('+').unwrap_or(value);
            let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
            digits
                .parse::<u32>()
                .ok()
                .filter(|value| *value <= 2_147_483_647)
                .unwrap_or(fallback)
        }
        if !node.has_name("canvas") {
            return Ok(None);
        }
        let width = dimension(node, "width", 300)
            .to_f32()
            .ok_or_else(|| unsupported("canvas intrinsic width"))?;
        let height = dimension(node, "height", 150)
            .to_f32()
            .ok_or_else(|| unsupported("canvas intrinsic height"))?;
        let ratio = if width > 0.0 && height > 0.0 {
            Some(width / height)
        } else {
            None
        };
        style.item_is_replaced = true;
        style.aspect_ratio = ratio;
        Ok(Some(Self {
            width: Some(width),
            height: Some(height),
            ratio,
        }))
    }
    pub(super) fn image(
        node: NodeRef<'_>,
        style: &mut Style,
        info: &crate::images::Info,
    ) -> Result<Self> {
        if info.intrinsic.is_none()
            && info.complete
            && (style.size.width.is_auto() || style.size.height.is_auto())
            && (!info.current_src.is_empty()
                || node
                    .null_attribute("src")
                    .is_some_and(|src| src.trim().is_empty())
                || node
                    .null_attribute("alt")
                    .is_some_and(|alt| !alt.is_empty()))
        {
            return Err(unsupported("broken image or alternate text layout"));
        }
        let intrinsic = info.intrinsic.unwrap_or(Size {
            width: 0.0,
            height: 0.0,
        });
        let width = intrinsic
            .width
            .to_f32()
            .ok_or_else(|| unsupported("image intrinsic width"))?;
        let height = intrinsic
            .height
            .to_f32()
            .ok_or_else(|| unsupported("image intrinsic height"))?;
        let ratio = if width > 0.0 && height > 0.0 {
            Some(width / height)
        } else {
            style.aspect_ratio
        };
        style.aspect_ratio = None;
        Ok(Self {
            width: Some(width),
            height: Some(height),
            ratio,
        })
    }
    pub(super) fn measure(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
    ) -> Size<f32> {
        match (known.width, known.height, self.ratio) {
            (Some(width), Some(height), _) => Size { width, height },
            (Some(width), None, Some(ratio)) => Size {
                width,
                height: width / ratio,
            },
            (None, Some(height), Some(ratio)) => Size {
                width: height * ratio,
                height,
            },
            _ => {
                let width = known
                    .width
                    .or(self.width)
                    .or_else(|| self.height.zip(self.ratio).map(|(h, r)| h * r))
                    .unwrap_or(match (self.ratio, available.width) {
                        (Some(_), AvailableSpace::Definite(width)) => width,
                        _ => 300.0,
                    });
                let height = known
                    .height
                    .or(self.ratio.map(|ratio| width / ratio))
                    .or(self.height)
                    .unwrap_or(150.0);
                Size { width, height }
            }
        }
    }
}

pub(super) fn image_attributes(node: NodeRef<'_>, style: &mut Style) -> Result<()> {
    if !crate::images::element(node) {
        return Ok(());
    }
    style.item_is_replaced = true;
    style.size.width = image_dimension(node, "width")?.unwrap_or(Dimension::AUTO);
    style.size.height = image_dimension(node, "height")?.unwrap_or(Dimension::AUTO);
    if let (
        taffy::style::ExpandedDimension::Length(width),
        taffy::style::ExpandedDimension::Length(height),
    ) = (style.size.width.expand(), style.size.height.expand())
        && width > 0.0
        && height > 0.0
    {
        style.aspect_ratio = Some(width / height);
    }
    Ok(())
}

fn image_dimension(node: NodeRef<'_>, name: &str) -> Result<Option<Dimension>> {
    let Some(value) = node.null_attribute(name) else {
        return Ok(None);
    };
    let value = value.trim_start_matches([' ', '\t', '\n', '\r', '\u{c}']);
    if !value.as_bytes().first().is_some_and(u8::is_ascii_digit) {
        return Ok(None);
    }
    let bytes = value.as_bytes();
    let mut end = 0;
    while bytes.get(end).is_some_and(u8::is_ascii_digit) {
        end = end.saturating_add(1);
    }
    if bytes.get(end) == Some(&b'.') {
        end = end.saturating_add(1);
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end = end.saturating_add(1);
        }
    }
    let number = value[..end]
        .parse::<f32>()
        .map_err(|_error| unsupported("image dimension attribute range"))?;
    if !number.is_finite() {
        return Err(unsupported("image dimension attribute range"));
    }
    if value[end..]
        .trim_start_matches([' ', '\t', '\n', '\r', '\u{c}'])
        .starts_with('%')
    {
        Ok(Some(Dimension::percent(number / 100.0)))
    } else {
        Ok(Some(Dimension::length(number)))
    }
}
