//! Computed length/percentage expressions with an unresolved positioning basis.
use crate::{Error, Result, fonts::Context, layout::Work};
use lightningcss::values::length::LengthPercentage;

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: background position {detail}"))
}

#[derive(Clone)]
pub(crate) enum Value {
    Linear { percent: Option<f64>, pixels: f64 },
    Function(&'static str, Vec<Self>),
    Sum(Box<Self>, Box<Self>),
    Product(f64, Box<Self>),
}

impl Value {
    pub(crate) fn percent(value: f64) -> Self {
        Self::Linear {
            percent: Some(value),
            pixels: 0.0,
        }
    }
    pub(crate) fn pixels(value: f64) -> Self {
        Self::Linear {
            percent: None,
            pixels: value,
        }
    }
    fn finite(mut self) -> Result<Self> {
        let finite = match &self {
            Self::Linear { percent, pixels } => {
                pixels.is_finite() && percent.is_none_or(f64::is_finite)
            }
            Self::Product(factor, _) => factor.is_finite(),
            _ => true,
        };
        if finite {
            if let Self::Linear { percent, pixels } = &mut self {
                if *pixels == 0.0 {
                    *pixels = 0.0;
                }
                if let Some(value) = percent
                    && *value == 0.0
                {
                    *value = 0.0;
                }
            }
            self.depth(0)?;
            Ok(self)
        } else {
            Err(unsupported("non-finite value"))
        }
    }
    pub(crate) fn add(self, other: Self) -> Result<Self> {
        match (self, other) {
            (
                Self::Linear {
                    percent: a,
                    pixels: x,
                },
                Self::Linear {
                    percent: b,
                    pixels: y,
                },
            ) => Self::Linear {
                percent: if a.is_some() || b.is_some() {
                    Some(a.unwrap_or_default() + b.unwrap_or_default())
                } else {
                    None
                },
                pixels: x + y,
            }
            .finite(),
            (a, b) => Self::Sum(Box::new(a), Box::new(b)).finite(),
        }
    }
    pub(crate) fn multiply(self, factor: f64) -> Result<Self> {
        match self {
            Self::Linear { percent, pixels } => Self::Linear {
                percent: percent.map(|value| value * factor),
                pixels: pixels * factor,
            }
            .finite(),
            value => Self::Product(factor, Box::new(value)).finite(),
        }
    }
    fn depth(&self, depth: usize) -> Result<()> {
        if depth > 32 {
            return Err(Error::Limit("background position nesting"));
        }
        let next = depth.saturating_add(1);
        match self {
            Self::Function(_, values) => {
                for value in values {
                    value.depth(next)?;
                }
            }
            Self::Sum(a, b) => {
                a.depth(next)?;
                b.depth(next)?;
            }
            Self::Product(_, value) => value.depth(next)?,
            Self::Linear { .. } => {}
        }
        Ok(())
    }
    pub(crate) fn from_css(
        value: &str,
        fonts: &Context,
        work: &mut Work<'_>,
        preserve: bool,
    ) -> Result<Self> {
        crate::position_math::parse(value, fonts, work, preserve)
    }
    pub(crate) fn literal(
        value: &LengthPercentage,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        work.charge()?;
        match value {
            LengthPercentage::Percentage(value) => {
                Self::percent(f64::from(value.0) * 100.0).finite()
            }
            LengthPercentage::Dimension(_) => {
                Self::pixels(fonts.relative_length(value, work)?).finite()
            }
            LengthPercentage::Calc(_) => Err(unsupported("literal calculation")),
        }
    }
    pub(crate) fn offset_from_end(self) -> Result<Self> {
        Self::percent(100.0).add(self.multiply(-1.0)?)
    }
    fn body(&self) -> Result<String> {
        match self {
            Self::Linear {
                percent: None,
                pixels,
            } => crate::fonts::pixels(*pixels),
            Self::Linear {
                percent: Some(percent),
                pixels,
            } => {
                let percent = format!("{}%", number(*percent)?);
                if *pixels == 0.0 {
                    return Ok(percent);
                }
                Ok(format!(
                    "{percent} {} {}",
                    if *pixels < 0.0 { "-" } else { "+" },
                    crate::fonts::pixels(pixels.abs())?
                ))
            }
            Self::Function(name, values) => Ok(format!(
                "{name}({})",
                values
                    .iter()
                    .map(Self::body)
                    .collect::<Result<Vec<_>>>()?
                    .join(", ")
            )),
            Self::Sum(a, b) => Ok(format!("({}) + ({})", a.body()?, b.body()?)),
            Self::Product(factor, value) => {
                Ok(format!("{} * ({})", number(*factor)?, value.body()?))
            }
        }
    }
    pub(crate) fn value(&self) -> Result<String> {
        let body = self.body()?;
        if matches!(self, Self::Linear {percent: Some(_), pixels} if *pixels != 0.0)
            || matches!(self, Self::Sum(..) | Self::Product(..))
        {
            Ok(format!("calc({body})"))
        } else {
            Ok(body)
        }
    }
}

fn number(value: f64) -> Result<String> {
    Ok(crate::fonts::pixels(value)?
        .trim_end_matches("px")
        .to_owned())
}

pub(crate) fn function_value(
    name: &'static str,
    values: Vec<Value>,
    preserve: bool,
) -> Result<Value> {
    let mut numbers = Vec::new();
    let mut basis = None;
    for value in &values {
        let Value::Linear { percent, pixels } = value else {
            return Value::Function(name, values).finite();
        };
        let (is_percent, number) = if let Some(percent) = percent {
            if *pixels != 0.0 {
                return Value::Function(name, values).finite();
            }
            (true, *percent)
        } else {
            (false, *pixels)
        };
        if basis.is_some_and(|basis| basis != is_percent) {
            return Value::Function(name, values).finite();
        }
        basis = Some(is_percent);
        numbers.push(number);
    }
    if preserve && basis == Some(true) {
        return Value::Function(name, values).finite();
    }
    let result = match name {
        "min" => numbers.iter().copied().reduce(f64::min),
        "max" => numbers.iter().copied().reduce(f64::max),
        "clamp" => match numbers.as_slice() {
            [min, value, max] => Some(min.max(value.min(*max))),
            _ => None,
        },
        _ => None,
    }
    .ok_or_else(|| unsupported("empty math function"))?;
    if basis == Some(true) {
        Value::percent(result).finite()
    } else {
        Value::pixels(result).finite()
    }
}
