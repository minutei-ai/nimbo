//! Native text-size-adjust state for the current desktop layout environment.
use crate::{Error, Result};
use lightningcss::{
    properties::text::TextSizeAdjust,
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::percentage::Percentage,
};

#[derive(Clone, Copy, PartialEq, Default)]
pub(crate) enum Adjustment {
    #[default]
    Auto,
    None,
    Percentage(f32),
}

pub(crate) fn specified(value: &str) -> Option<String> {
    let parsed = TextSizeAdjust::parse_string(value).ok()?;
    if let TextSizeAdjust::Percentage(Percentage(number)) = &parsed
        && (!number.is_finite() || (*number < 0.0 && !crate::styles::function_value(value)))
    {
        return None;
    }
    let serialized = parsed.to_css_string(PrinterOptions::default()).ok()?;
    Some(
        if value
            .trim_start()
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("calc("))
        {
            format!("calc({serialized})")
        } else if crate::styles::function_value(value) {
            value.trim().to_owned()
        } else {
            serialized
        },
    )
}

impl Adjustment {
    pub(crate) fn compute(self, value: &str) -> Result<Self> {
        match value {
            "" | "inherit" | "unset" => Ok(self),
            "initial" | "auto" => Ok(Self::Auto),
            "none" => Ok(Self::None),
            _ => match TextSizeAdjust::parse_string(value)
                .map_err(|_error| Error::Dom("layout unsupported: text-size-adjust".into()))?
            {
                TextSizeAdjust::Auto => Ok(Self::Auto),
                TextSizeAdjust::None => Ok(Self::None),
                TextSizeAdjust::Percentage(Percentage(value)) if value.is_finite() => {
                    Ok(Self::Percentage(value.max(0.0)))
                }
                TextSizeAdjust::Percentage(_) => Err(Error::Dom(
                    "layout unsupported: text-size-adjust percentage".into(),
                )),
            },
        }
    }
    pub(crate) fn value(self) -> Result<String> {
        let value = match self {
            Self::Auto => TextSizeAdjust::Auto,
            Self::None => TextSizeAdjust::Percentage(Percentage(1.0)),
            Self::Percentage(value) => TextSizeAdjust::Percentage(Percentage(value)),
        };
        value
            .to_css_string(PrinterOptions::default())
            .map_err(|_error| Error::Dom("computed text-size-adjust serialization".into()))
    }
}
