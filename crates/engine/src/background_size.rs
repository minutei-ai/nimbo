//! Native computed image sizing state; image scaling and painting remain separate.
use crate::{
    Error, Result, fonts::Context, layout::Work, position_value::Value, styles::Declarations,
};
use cssparser::{Parser, ParserInput, Token};
use lightningcss::{
    properties::{Property, PropertyId},
    stylesheet::ParserOptions,
};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: background size {detail}"))
}

pub(crate) fn specified(value: &str) -> Option<String> {
    let parsed =
        Property::parse_string(PropertyId::BackgroundSize, value, ParserOptions::default()).ok()?;
    if !matches!(parsed, Property::BackgroundSize(_)) {
        return None;
    }
    for layer in crate::background_position::parts(value)? {
        for component in layer {
            let mut source = ParserInput::new(&component);
            if matches!(Parser::new(&mut source).next().ok()?, Token::Number {value, ..} | Token::Dimension {value, ..} if *value < 0.0)
                || matches!(Parser::new(&mut ParserInput::new(&component)).next().ok()?, Token::Percentage {unit_value, ..} if *unit_value < 0.0)
            {
                return None;
            }
        }
    }
    Some(value.trim().to_owned())
}

#[derive(Clone)]
enum Layer {
    Keyword(&'static str),
    Explicit(Option<Value>, Option<Value>),
}

fn dimension(value: &str, fonts: &Context, work: &mut Work<'_>) -> Result<Option<Value>> {
    if value == "auto" {
        return Ok(None);
    }
    Value::from_css(value, fonts, work, false).map(|value| Some(value.nonnegative()))
}

impl Layer {
    fn parse(parts: &[String], fonts: &Context, work: &mut Work<'_>) -> Result<Self> {
        work.charge()?;
        match parts {
            [value] if value == "cover" => Ok(Self::Keyword("cover")),
            [value] if value == "contain" => Ok(Self::Keyword("contain")),
            [width] => Ok(Self::Explicit(dimension(width, fonts, work)?, None)),
            [width, height] => Ok(Self::Explicit(
                dimension(width, fonts, work)?,
                dimension(height, fonts, work)?,
            )),
            _ => Err(unsupported("syntax")),
        }
    }
    fn charge(&self, work: &mut Work<'_>) -> Result<()> {
        work.charge()?;
        if let Self::Explicit(width, height) = self {
            for value in [width, height].into_iter().flatten() {
                value.charge(work)?;
            }
        }
        Ok(())
    }
    fn value(&self) -> Result<String> {
        match self {
            Self::Keyword(value) => Ok((*value).into()),
            Self::Explicit(None, None) => Ok("auto".into()),
            Self::Explicit(width, height) => Ok(format!(
                "{} {}",
                width.as_ref().map_or(Ok("auto".into()), Value::value)?,
                height.as_ref().map_or(Ok("auto".into()), Value::value)?
            )),
        }
    }
}

#[derive(Clone)]
pub(crate) struct Sizes {
    layers: Vec<Layer>,
    failure: Option<String>,
}
impl Default for Sizes {
    fn default() -> Self {
        Self {
            layers: vec![Layer::Explicit(None, None)],
            failure: None,
        }
    }
}

impl Sizes {
    fn parsed(value: &str, fonts: &Context, work: &mut Work<'_>) -> Result<Self> {
        specified(value).ok_or_else(|| unsupported("syntax"))?;
        let layers = crate::background_position::parts(value)
            .ok_or_else(|| unsupported("syntax"))?
            .iter()
            .map(|parts| Layer::parse(parts, fonts, work))
            .collect::<Result<Vec<_>>>();
        match layers {
            Ok(layers) => Ok(Self {
                layers,
                failure: None,
            }),
            Err(Error::Dom(message)) if message.starts_with("layout unsupported:") => Ok(Self {
                layers: Vec::new(),
                failure: Some(message),
            }),
            Err(error) => Err(error),
        }
    }
    fn expanded(&self, count: usize, work: &mut Work<'_>) -> Result<Self> {
        let mut layers = Vec::new();
        for layer in self.layers.iter().cycle().take(count) {
            layer.charge(work)?;
            layers.push(layer.clone());
        }
        Ok(Self {
            layers,
            failure: self.failure.clone(),
        })
    }
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        count: usize,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let (value, _) = declarations.value("background-size");
        match value.as_str() {
            "inherit" => self.expanded(count, work),
            "" | "initial" | "unset" | "revert" => Self::default().expanded(count, work),
            _ => Self::parsed(&value, fonts, work)?.expanded(count, work),
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        self.failure
            .as_ref()
            .map_or(Ok(()), |message| Err(Error::Dom(message.clone())))
    }
    pub(crate) fn value(&self) -> Result<String> {
        self.validate()?;
        let mut values = Vec::new();
        let mut bytes = 0_usize;
        for layer in &self.layers {
            let value = layer.value()?;
            bytes = bytes.saturating_add(value.len()).saturating_add(2);
            if bytes > 2 * 1024 * 1024 {
                return Err(Error::Limit("computed background size bytes"));
            }
            values.push(value);
        }
        Ok(values.join(", "))
    }
}
