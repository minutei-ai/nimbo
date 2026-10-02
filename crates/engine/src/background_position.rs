//! Native computed background positioning axes; painting uses their unresolved basis.
use crate::{
    Error, Result, fonts::Context, layout::Work, position_value::Value, styles::Declarations,
};
use cssparser::{Parser, ParserInput, Token};
use lightningcss::{
    properties::{Property, PropertyId},
    stylesheet::ParserOptions,
};

const VALUE_BYTES: usize = 2 * 1024 * 1024;

pub(crate) fn specified_axis(name: &str, value: &str) -> Option<String> {
    let parsed =
        Property::parse_string(PropertyId::from(name), value, ParserOptions::default()).ok()?;
    matches!(
        parsed,
        Property::BackgroundPositionX(_) | Property::BackgroundPositionY(_)
    )
    .then(|| value.trim().to_owned())
}

pub(crate) fn specified(value: &str) -> Option<(String, String)> {
    let parsed = Property::parse_string(
        PropertyId::BackgroundPosition,
        value,
        ParserOptions::default(),
    )
    .ok()?;
    if !matches!(parsed, Property::BackgroundPosition(_)) {
        return None;
    }
    let mut x = Vec::new();
    let mut y = Vec::new();
    for parts in parts(value)? {
        let (a, b) = axes(&parts)?;
        x.push(a);
        y.push(b);
    }
    Some((x.join(", "), y.join(", ")))
}

fn parts(value: &str) -> Option<Vec<Vec<String>>> {
    let mut source = ParserInput::new(value);
    let input = &mut Parser::new(&mut source);
    let mut layers = Vec::new();
    let mut layer = Vec::new();
    while !input.is_exhausted() {
        let start = input.position();
        let token = input.next().ok()?.clone();
        let value = match token {
            Token::Comma => {
                layers.push(layer);
                layer = Vec::new();
                continue;
            }
            Token::Ident(value) => value.to_ascii_lowercase(),
            Token::Function(_) => {
                input
                    .parse_nested_block(|input| crate::styles::components(input, 0, false))
                    .ok()?;
                input.slice_from(start).trim().to_owned()
            }
            Token::Number { .. } | Token::Dimension { .. } | Token::Percentage { .. } => {
                input.slice_from(start).trim().to_owned()
            }
            _ => return None,
        };
        layer.push(value);
    }
    layers.push(layer);
    Some(layers)
}

fn vertical(value: &str) -> bool {
    matches!(
        value.split_ascii_whitespace().next(),
        Some("top" | "bottom")
    )
}
fn side(value: &str) -> bool {
    matches!(value, "top" | "bottom" | "left" | "right" | "center")
}
fn axes(parts: &[String]) -> Option<(String, String)> {
    match parts {
        [a] if vertical(a) => Some(("center".into(), a.clone())),
        [a] => Some((a.clone(), "center".into())),
        [a, b] if vertical(a) || (a == "center" && matches!(b.as_str(), "left" | "right")) => {
            Some((b.clone(), a.clone()))
        }
        [a, b] => Some((a.clone(), b.clone())),
        [a, b, c] => {
            let (first, second) = if side(b) {
                (a.clone(), format!("{b} {c}"))
            } else {
                (format!("{a} {b}"), c.clone())
            };
            if vertical(&first)
                || (first == "center"
                    && matches!(
                        second.split_ascii_whitespace().next(),
                        Some("left" | "right")
                    ))
            {
                Some((second, first))
            } else {
                Some((first, second))
            }
        }
        [a, b, c, d] => {
            let first = format!("{a} {b}");
            let second = format!("{c} {d}");
            if vertical(a) {
                Some((second, first))
            } else {
                Some((first, second))
            }
        }
        _ => None,
    }
}
#[derive(Clone)]
struct Axis {
    values: Vec<Value>,
    failure: Option<String>,
}

impl Default for Axis {
    fn default() -> Self {
        Self {
            values: vec![Value::percent(0.0)],
            failure: None,
        }
    }
}

fn axis(parts: &[String], fonts: &Context, work: &mut Work<'_>, preserve: bool) -> Result<Value> {
    let invalid = || Error::Dom("layout unsupported: background position syntax".into());
    let first = parts.first().ok_or_else(invalid)?;
    match first.as_str() {
        "center" if parts.len() == 1 => Ok(Value::percent(50.0)),
        "left" | "right" | "top" | "bottom" => {
            let end = matches!(first.as_str(), "right" | "bottom");
            match parts {
                [_] => Ok(Value::percent(if end { 100.0 } else { 0.0 })),
                [_, offset] => {
                    let value = Value::from_css(offset, fonts, work, preserve)?;
                    if end {
                        value.offset_from_end()
                    } else {
                        Ok(value)
                    }
                }
                _ => Err(invalid()),
            }
        }
        _ if parts.len() == 1 => Value::from_css(first, fonts, work, preserve),
        _ => Err(invalid()),
    }
}

impl Axis {
    fn compute(
        &self,
        name: &str,
        value: &str,
        preserve: bool,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        match value {
            "inherit" => return Ok(self.clone()),
            "" | "initial" | "unset" => return Ok(Self::default()),
            _ => {}
        }
        work.charge()?;
        let parsed =
            Property::parse_string(PropertyId::from(name), value, ParserOptions::default())
                .map_err(|_error| {
                    Error::Dom("layout unsupported: background position syntax".into())
                })?;
        if !matches!(
            parsed,
            Property::BackgroundPositionX(_) | Property::BackgroundPositionY(_)
        ) {
            return Err(Error::Dom(
                "layout unsupported: background position syntax".into(),
            ));
        }
        let values = parts(value)
            .ok_or_else(|| Error::Dom("layout unsupported: background position syntax".into()))?
            .iter()
            .map(|parts| axis(parts, fonts, work, preserve))
            .collect::<Result<Vec<_>>>();
        match values {
            Ok(values) => Ok(Self {
                values,
                failure: None,
            }),
            Err(Error::Dom(message)) if message.starts_with("layout unsupported:") => Ok(Self {
                values: Vec::new(),
                failure: Some(message),
            }),
            Err(error) => Err(error),
        }
    }
    fn validate(&self) -> Result<()> {
        self.failure
            .as_ref()
            .map_or(Ok(()), |message| Err(Error::Dom(message.clone())))
    }
    fn values(&self, count: usize) -> Result<Vec<String>> {
        self.validate()?;
        let mut values = Vec::new();
        let mut bytes = 0_usize;
        for value in self.values.iter().cycle().take(count) {
            let value = value.value()?;
            bytes = bytes.saturating_add(value.len()).saturating_add(2);
            if bytes > VALUE_BYTES {
                return Err(Error::Limit("computed background position bytes"));
            }
            values.push(value);
        }
        Ok(values)
    }
}

#[derive(Clone, Default)]
pub(crate) struct Positions {
    x: Axis,
    y: Axis,
}

pub(crate) fn property(name: &str) -> bool {
    matches!(name, "background-position-x" | "background-position-y")
}

impl Positions {
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        Ok(Self {
            x: self.x.compute(
                "background-position-x",
                &declarations.value("background-position-x").0,
                declarations.position_shorthand("background-position-x"),
                fonts,
                work,
            )?,
            y: self.y.compute(
                "background-position-y",
                &declarations.value("background-position-y").0,
                declarations.position_shorthand("background-position-y"),
                fonts,
                work,
            )?,
        })
    }
    pub(crate) fn validate(&self) -> Result<()> {
        self.x.validate()?;
        self.y.validate()
    }
    pub(crate) fn value(&self, name: &str, count: usize) -> Result<String> {
        match name {
            "background-position-x" => Ok(self.x.values(count)?.join(", ")),
            "background-position-y" => Ok(self.y.values(count)?.join(", ")),
            "background-position" => {
                let x = self.x.values(count)?;
                let y = self.y.values(count)?;
                let bytes = x
                    .iter()
                    .chain(&y)
                    .fold(0_usize, |bytes, value| bytes.saturating_add(value.len()));
                if bytes.saturating_add(count.saturating_mul(3)) > VALUE_BYTES {
                    return Err(Error::Limit("computed background position bytes"));
                }
                Ok(x.iter()
                    .zip(y)
                    .map(|(x, y)| format!("{x} {y}"))
                    .collect::<Vec<_>>()
                    .join(", "))
            }
            _ => Err(Error::Dom(
                "layout unsupported: computed background position property".into(),
            )),
        }
    }
}
