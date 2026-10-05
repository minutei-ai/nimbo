//! Outermost SVG viewports are replaced boxes with native intrinsic sizing.
use cssparser::{Parser, ParserInput};
use dom_query::NodeRef;
use lightningcss::{traits::Parse, values::length::LengthPercentage};
use taffy::{prelude::*, style::ExpandedDimension};

use super::{Work, lengths, unsupported};
use crate::{Result, fonts::Context};

pub(crate) fn is_svg(node: NodeRef<'_>) -> bool {
    node.qual_name_ref()
        .as_ref()
        .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/2000/svg")
}

pub(crate) fn root(node: NodeRef<'_>) -> bool {
    is_svg(node) && node.has_name("svg") && !node.ancestors_it(None).any(is_svg)
}

pub(crate) fn geometry(node: NodeRef<'_>) -> Result<()> {
    if is_svg(node) && !root(node) {
        return Err(unsupported("SVG graphics geometry"));
    }
    Ok(())
}

pub(super) fn paint_property(name: &str) -> bool {
    matches!(
        name,
        "fill"
            | "fill-opacity"
            | "fill-rule"
            | "stroke"
            | "stroke-width"
            | "stroke-opacity"
            | "stroke-linecap"
            | "stroke-linejoin"
    )
}

#[derive(Clone, Copy)]
pub(super) struct Intrinsic {
    width: Option<f32>,
    height: Option<f32>,
    ratio: Option<f32>,
}

impl Intrinsic {
    pub(super) fn apply(
        node: NodeRef<'_>,
        style: &mut Style,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Option<Self>> {
        if !root(node) {
            return Ok(None);
        }
        if node.has_attr("transform") {
            return Err(unsupported("SVG viewport transform"));
        }
        style.item_is_replaced = true;
        style.size.width = attribute(node, "width", fonts, work)?.unwrap_or(Dimension::auto());
        style.size.height = attribute(node, "height", fonts, work)?.unwrap_or(Dimension::auto());
        let absolute = |value: Dimension| match value.expand() {
            ExpandedDimension::Length(value) => Some(value),
            _ => None,
        };
        let width = absolute(style.size.width);
        let height = absolute(style.size.height);
        let ratio = width
            .zip(height)
            .filter(|(w, h)| *w > 0.0 && *h > 0.0)
            .map(|(w, h)| w / h);
        if ratio.is_some_and(|ratio| !ratio.is_finite()) {
            return Err(unsupported("SVG intrinsic ratio range"));
        }
        let ratio = ratio.or(view_box_ratio(node, work)?);
        style.aspect_ratio = ratio;
        Ok(Some(Self {
            width,
            height,
            ratio,
        }))
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

fn attribute(
    node: NodeRef<'_>,
    name: &str,
    fonts: &Context,
    work: &mut Work<'_>,
) -> Result<Option<Dimension>> {
    let Some(value) = node.attr(name) else {
        return Ok(None);
    };
    work.charge()?;
    let value = value.trim();
    if let Ok(number) = value.parse::<f32>() {
        return Ok(number
            .is_finite()
            .then(|| Dimension::length(number.max(0.0))));
    }
    if value.is_empty() || value == "auto" {
        return Ok(None);
    }
    if LengthPercentage::parse_string(value).is_err() {
        return Ok(Some(Dimension::percent(1.0)));
    }
    if value.starts_with('-') {
        return Ok(Some(Dimension::length(0.0)));
    }
    let value = lengths::value(name, value, fonts, work)?;
    Ok(value.parse().ok())
}

fn view_box_ratio(node: NodeRef<'_>, work: &mut Work<'_>) -> Result<Option<f32>> {
    let Some(value) = node.attr("viewBox") else {
        return Ok(None);
    };
    let mut input = ParserInput::new(&value);
    let mut parser = Parser::new(&mut input);
    let mut numbers = [0.0; 4];
    for (index, number) in numbers.iter_mut().enumerate() {
        work.charge()?;
        if index > 0 {
            let _comma = parser.try_parse(Parser::expect_comma);
        }
        let Ok(value) = parser.expect_number() else {
            return Ok(None);
        };
        if !value.is_finite() {
            return Ok(None);
        }
        *number = value;
    }
    let [_, _, width, height] = numbers;
    if parser.expect_exhausted().is_ok() && width > 0.0 && height > 0.0 {
        let ratio = width / height;
        if !ratio.is_finite() {
            return Err(unsupported("SVG intrinsic ratio range"));
        }
        Ok(Some(ratio))
    } else {
        Ok(None)
    }
}
