//! Native computed tab-size; tab-stop text layout is not implemented here.
use crate::{Error, Result, fonts::Context, layout::Work};
use lightningcss::{
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::length::{Length, LengthOrNumber},
};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Tabs {
    Number(f32),
    Length(f64),
}
impl Default for Tabs {
    fn default() -> Self {
        Self::Number(8.0)
    }
}

pub(crate) fn specified(value: &str) -> Option<String> {
    let parsed = LengthOrNumber::parse_string(value).ok()?;
    let negative = match &parsed {
        LengthOrNumber::Number(number) => {
            if !number.is_finite() {
                return None;
            }
            *number < 0.0
        }
        LengthOrNumber::Length(Length::Value(length)) => length.to_unit_value().0 < 0.0,
        LengthOrNumber::Length(Length::Calc(_)) => false,
    };
    if negative && !crate::styles::function_value(value) {
        return None;
    }
    let mut serialized = parsed.to_css_string(PrinterOptions::default()).ok()?;
    if matches!(parsed, LengthOrNumber::Length(_)) && serialized == "0" {
        serialized = "0px".into();
    }
    Some(
        if value
            .trim_start()
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("calc("))
            && !serialized.starts_with("calc(")
        {
            format!("calc({serialized})")
        } else if crate::styles::function_value(value) {
            value.trim().to_owned()
        } else {
            serialized
        },
    )
}
impl Tabs {
    pub(crate) fn compute(self, value: &str, fonts: &Context, work: &mut Work<'_>) -> Result<Self> {
        match value {
            "" | "inherit" | "unset" => Ok(self),
            "initial" => Ok(Self::default()),
            _ => match LengthOrNumber::parse_string(value)
                .map_err(|_error| Error::Dom("layout unsupported: tab-size".into()))?
            {
                LengthOrNumber::Number(number) if number.is_finite() => {
                    Ok(Self::Number(number.max(0.0)))
                }
                LengthOrNumber::Number(_) => {
                    Err(Error::Dom("layout unsupported: non-finite tab-size".into()))
                }
                LengthOrNumber::Length(length) => {
                    Ok(Self::Length(fonts.length(&length, work)?.max(0.0)))
                }
            },
        }
    }
    pub(crate) fn value(self) -> Result<String> {
        match self {
            Self::Number(value) => Ok(value.to_string()),
            Self::Length(value) => crate::fonts::pixels(value),
        }
    }
}
