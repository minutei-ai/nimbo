//! Bounded legacy vertical line clamping for native text-only boxes.
use super::unsupported;
use crate::{Result, styles::Declarations};
use num_traits::ToPrimitive;
use taffy::{LengthPercentageAuto, Style, style::ExpandedLengthPercentage};

pub(super) fn lines(declarations: &Declarations) -> Result<Option<u32>> {
    if declarations.value("display").0 != "-webkit-box" {
        return Ok(None);
    }
    if declarations.value("-webkit-box-orient").0 != "vertical" {
        return Err(unsupported("legacy box orientation"));
    }
    let lines = declarations
        .value("-webkit-line-clamp")
        .0
        .parse::<u32>()
        .ok()
        .filter(|n| (1..=256).contains(n))
        .ok_or_else(|| unsupported("legacy line clamp count"))?;
    Ok(Some(lines))
}

pub(super) fn apply(style: &mut Style, line_height: f64, lines: u32) -> Result<()> {
    if !style.size.height.is_auto() || !style.max_size.height.is_auto() {
        return Err(unsupported("line clamp explicit height constraint"));
    }
    let length = |value: taffy::LengthPercentage| match value.expand() {
        ExpandedLengthPercentage::Length(value) => Ok(value),
        ExpandedLengthPercentage::Percent(_) => Err(unsupported("line clamp percentage inset")),
    };
    let inset = length(style.padding.top)?
        + length(style.padding.bottom)?
        + length(style.border.top)?
        + length(style.border.bottom)?;
    let height = (line_height * f64::from(lines))
        .to_f32()
        .filter(|n| n.is_finite())
        .ok_or_else(|| unsupported("line clamp height range"))?;
    style.max_size.height = LengthPercentageAuto::length(
        height
            + if style.box_sizing == taffy::BoxSizing::BorderBox {
                inset
            } else {
                0.0
            },
    );
    Ok(())
}
