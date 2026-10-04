//! Computed stack levels; painting and hit testing consume separate capabilities.
use crate::{Error, Result};
use lightningcss::{
    properties::position::ZIndex,
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::number::CSSNumber,
};
use num_traits::ToPrimitive;

#[derive(Clone, Copy, Default)]
pub(crate) struct Index(Option<i32>);

fn number(value: &str) -> Option<f32> {
    let number = CSSNumber::parse_string(value).ok()?;
    number.is_finite().then_some(number)
}

pub(crate) fn specified(value: &str) -> Option<String> {
    if crate::styles::function_value(value) {
        let value = number(value)?
            .to_css_string(PrinterOptions::default())
            .ok()?;
        Some(format!("calc({value})"))
    } else {
        ZIndex::parse_string(value)
            .ok()?
            .to_css_string(PrinterOptions::default())
            .ok()
    }
}

impl Index {
    pub(crate) fn compute(self, value: &str) -> Result<Self> {
        match value {
            "inherit" => Ok(self),
            "" | "initial" | "unset" | "revert" | "auto" => Ok(Self::default()),
            _ => {
                let invalid = || Error::Dom("layout unsupported: z-index value".into());
                let index = if crate::styles::function_value(value) {
                    // CSS integer calculations round ties toward positive infinity.
                    (f64::from(number(value).ok_or_else(invalid)?) + 0.5)
                        .floor()
                        .clamp(f64::from(i32::MIN), f64::from(i32::MAX))
                        .to_i32()
                        .ok_or_else(invalid)?
                } else {
                    match ZIndex::parse_string(value).map_err(|_error| invalid())? {
                        ZIndex::Auto => return Ok(Self::default()),
                        ZIndex::Integer(value) => value,
                    }
                };
                Ok(Self(Some(index)))
            }
        }
    }

    pub(crate) fn value(self) -> String {
        self.0
            .map_or_else(|| "auto".into(), |index| index.to_string())
    }
}
