//! Native line-height values; font-metric line boxes and text shaping remain separate.
use crate::{Error, Result, fonts::Context, layout::Work};
use lightningcss::{
    properties::font::LineHeight,
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::length::LengthPercentage,
};

#[derive(Clone, Copy, PartialEq, Default)]
pub(crate) enum Height {
    #[default]
    Normal,
    Number(f32),
    Length(f64),
}

pub(crate) fn specified(value: &str) -> Option<String> {
    let parsed = LineHeight::parse_string(value).ok()?;
    let negative = match &parsed {
        LineHeight::Number(number) => {
            if !number.is_finite() {
                return None;
            }
            *number < 0.0
        }
        LineHeight::Length(LengthPercentage::Dimension(length)) => length.to_unit_value().0 < 0.0,
        LineHeight::Length(LengthPercentage::Percentage(number)) => number.0 < 0.0,
        LineHeight::Normal | LineHeight::Length(LengthPercentage::Calc(_)) => false,
    };
    if negative && !crate::styles::function_value(value) {
        return None;
    }
    let serialized = parsed.to_css_string(PrinterOptions::default()).ok()?;
    Some(if crate::styles::function_value(value) {
        value.trim().to_owned()
    } else {
        serialized
    })
}
impl Height {
    pub(crate) fn compute(self, value: &str, fonts: &Context, work: &mut Work<'_>) -> Result<Self> {
        match value {
            "" | "inherit" | "unset" => Ok(self),
            "initial" | "normal" => Ok(Self::Normal),
            _ => match LineHeight::parse_string(value)
                .map_err(|_error| Error::Dom("layout unsupported: line-height".into()))?
            {
                LineHeight::Normal => Ok(Self::Normal),
                LineHeight::Number(number) if number.is_finite() => {
                    Ok(Self::Number(number.max(0.0)))
                }
                LineHeight::Number(_) => Err(Error::Dom(
                    "layout unsupported: non-finite line-height".into(),
                )),
                LineHeight::Length(length) => {
                    Ok(Self::Length(fonts.relative_length(&length, work)?.max(0.0)))
                }
            },
        }
    }
    pub(crate) fn value(self, fonts: &Context) -> Result<String> {
        match self {
            Self::Normal => Ok("normal".into()),
            Self::Number(number) => crate::fonts::pixels(f64::from(number) * fonts.size()),
            Self::Length(length) => crate::fonts::pixels(length),
        }
    }
}
