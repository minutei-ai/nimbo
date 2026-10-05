//! Order-modified document order for flex and grid box children.
use crate::{Result, styles::Declarations};
use lightningcss::{traits::Parse, values::number::CSSNumber};
use num_traits::ToPrimitive;

pub(crate) fn compute(parent: i32, declarations: &Declarations) -> Result<i32> {
    let (value, _) = declarations.value("order");
    match value.as_str() {
        "inherit" => Ok(parent),
        "" | "initial" | "unset" | "revert" => Ok(0),
        _ => {
            let invalid = || super::unsupported("order value");
            if crate::styles::function_value(&value) {
                let number = CSSNumber::parse_string(&value).map_err(|_error| invalid())?;
                if !number.is_finite() {
                    return Err(invalid());
                }
                (f64::from(number) + 0.5)
                    .floor()
                    .clamp(f64::from(i32::MIN), f64::from(i32::MAX))
                    .to_i32()
                    .ok_or_else(invalid)
            } else {
                value.parse().map_err(|_error| invalid())
            }
        }
    }
}
