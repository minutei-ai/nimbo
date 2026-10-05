//! Native basic-shape bounds for rectangular `IntersectionObserver` v1 clipping.
use std::ops::Add;

use cssparser::{ParseError, Parser, ParserInput};
use lightningcss::{traits::Parse, values::length::LengthPercentage};

use super::{Bounds, Work, unsupported};
use crate::{Result, fonts::Context};

enum Shape {
    Inset([LengthPercentage; 4]),
    Polygon(Vec<(LengthPercentage, LengthPercentage)>),
}
pub(super) struct Clip {
    shape: Shape,
    fonts: Context,
}

fn shape<'i>(
    input: &mut Parser<'i, '_>,
    kind: &str,
) -> std::result::Result<Shape, ParseError<'i, ()>> {
    if kind.eq_ignore_ascii_case("inset") {
        let mut values = Vec::new();
        while !input.is_exhausted() {
            if values.len() == 4 {
                return Err(input.new_custom_error(()));
            }
            values
                .push(LengthPercentage::parse(input).map_err(|_error| input.new_custom_error(()))?);
        }
        let top = values
            .first()
            .ok_or_else(|| input.new_custom_error(()))?
            .clone();
        let right = values.get(1).unwrap_or(&top).clone();
        let bottom = values.get(2).unwrap_or(&top).clone();
        let left = values.get(3).unwrap_or(&right).clone();
        return Ok(Shape::Inset([top, right, bottom, left]));
    }
    if !kind.eq_ignore_ascii_case("polygon") {
        return Err(input.new_custom_error(()));
    }
    if input
        .try_parse(|p| p.expect_ident_matching("evenodd"))
        .is_ok()
        || input
            .try_parse(|p| p.expect_ident_matching("nonzero"))
            .is_ok()
    {
        input.expect_comma()?;
    }
    let mut points = Vec::new();
    loop {
        if points.len() == 256 {
            return Err(input.new_custom_error(()));
        }
        let x = LengthPercentage::parse(input).map_err(|_error| input.new_custom_error(()))?;
        let y = LengthPercentage::parse(input).map_err(|_error| input.new_custom_error(()))?;
        points.push((x, y));
        if input.is_exhausted() {
            break;
        }
        input.expect_comma()?;
    }
    if points.len() < 3 {
        return Err(input.new_custom_error(()));
    }
    Ok(Shape::Polygon(points))
}

impl Clip {
    pub(super) fn parse(value: &str, fonts: Context, work: &mut Work<'_>) -> Result<Option<Self>> {
        if matches!(value, "" | "none" | "initial" | "unset" | "revert") {
            return Ok(None);
        }
        if value.len() > 16_384 {
            return Err(crate::Error::Limit("clip-path bytes"));
        }
        let mut input = ParserInput::new(value);
        let mut parser = Parser::new(&mut input);
        let _reference_box = parser.try_parse(|p| p.expect_ident_matching("border-box"));
        let kind = parser
            .expect_function()
            .map_err(|_error| unsupported("clip-path shape"))?
            .clone();
        let shape = parser
            .parse_nested_block(|input| shape(input, &kind))
            .map_err(|_error| unsupported("clip-path shape"))?;
        let _reference_box = parser.try_parse(|p| p.expect_ident_matching("border-box"));
        parser
            .expect_exhausted()
            .map_err(|_error| unsupported("clip-path reference box"))?;
        let count = match &shape {
            Shape::Inset(_) => 4,
            Shape::Polygon(points) => points.len().saturating_mul(2),
        };
        for _ in 0..count {
            work.charge()?;
        }
        Ok(Some(Self { shape, fonts }))
    }

    pub(super) fn bounds(&self, rect: &Bounds, work: &mut Work<'_>) -> Result<Bounds> {
        let (left, top, right, bottom) = match &self.shape {
            Shape::Inset(values) => {
                let top = self.fonts.box_length(&values[0], rect.height, work)?;
                let right = self.fonts.box_length(&values[1], rect.width, work)?;
                let bottom = self.fonts.box_length(&values[2], rect.height, work)?;
                let left = self.fonts.box_length(&values[3], rect.width, work)?;
                let horizontal = self.fonts.box_length(
                    &values[1].clone().add(values[3].clone()),
                    rect.width,
                    work,
                )?;
                let vertical = self.fonts.box_length(
                    &values[0].clone().add(values[2].clone()),
                    rect.height,
                    work,
                )?;
                if horizontal >= rect.width || vertical >= rect.height {
                    return Ok(Bounds {
                        x: rect.x,
                        y: rect.y,
                        ..Bounds::default()
                    });
                }
                (left, top, rect.width - right, rect.height - bottom)
            }
            Shape::Polygon(points) => {
                let mut bounds = (
                    f64::INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                );
                for (x, y) in points {
                    work.charge()?;
                    let x = self.fonts.box_length(x, rect.width, work)?;
                    let y = self.fonts.box_length(y, rect.height, work)?;
                    bounds = (
                        bounds.0.min(x),
                        bounds.1.min(y),
                        bounds.2.max(x),
                        bounds.3.max(y),
                    );
                }
                bounds
            }
        };
        let result = Bounds {
            x: rect.x + left,
            y: rect.y + top,
            width: (right - left).max(0.0),
            height: (bottom - top).max(0.0),
        };
        if result.width == 0.0 || result.height == 0.0 {
            return Ok(Bounds {
                x: rect.x,
                y: rect.y,
                ..Bounds::default()
            });
        }
        if ![result.x, result.y, result.width, result.height]
            .iter()
            .all(|v| v.is_finite())
        {
            return Err(unsupported("clip-path range"));
        }
        Ok(result)
    }
}
