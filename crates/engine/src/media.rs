//! Native media-query parsing and evaluation against an explicit logical viewport.

use cssparser::{Parser, ParserInput, ToCss, Token};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Logical viewport and user preferences; this does not provide layout or paint.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaEnvironment {
    /// Logical viewport width in CSS pixels.
    pub width: u32,
    /// Logical viewport height in CSS pixels.
    pub height: u32,
    /// Explicit preferred color scheme (light or dark).
    pub color_scheme: String,
    /// Explicit reduced-motion preference.
    pub reduced_motion: bool,
}

impl Default for MediaEnvironment {
    fn default() -> Self {
        Self {
            width: 1024,
            height: 768,
            color_scheme: "light".into(),
            reduced_motion: false,
        }
    }
}

impl MediaEnvironment {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.width == 0
            || self.height == 0
            || self.width > 16_384
            || self.height > 16_384
            || !matches!(self.color_scheme.as_str(), "light" | "dark")
        {
            return Err(Error::Unsupported("invalid media environment".into()));
        }
        Ok(())
    }

    pub(crate) fn query(&self, source: &str) -> Result<String> {
        if source.len() > 64 * 1024 {
            return Err(Error::Limit("media query bytes"));
        }
        let mut input = ParserInput::new(source);
        let mut parser = Parser::new(&mut input);
        let tokens = lex(&mut parser, 0).map_err(|()| Error::Limit("media query nesting"))?;
        if tokens.is_empty() {
            return Ok(serde_json::json!({"media":"", "matches":true}).to_string());
        }
        let mut matches = false;
        let mut queries = Vec::new();
        for tokens in tokens.split(|token| matches!(token, Lex::Comma)) {
            match query(tokens, self) {
                Some(value) => {
                    matches |= value == Truth::Yes;
                    queries.push(if value == Truth::Unknown {
                        "not all".into()
                    } else {
                        serialize(tokens)
                    });
                }
                None => queries.push("not all".into()),
            }
        }
        Ok(serde_json::json!({"media":queries.join(", "), "matches":matches}).to_string())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Truth {
    Yes,
    No,
    Unknown,
}
impl Truth {
    fn from(value: bool) -> Self {
        if value { Self::Yes } else { Self::No }
    }
    fn not(self) -> Self {
        match self {
            Self::Yes => Self::No,
            Self::No => Self::Yes,
            Self::Unknown => Self::Unknown,
        }
    }
    fn and(self, other: Self) -> Self {
        if self == Self::No || other == Self::No {
            Self::No
        } else if self == Self::Unknown || other == Self::Unknown {
            Self::Unknown
        } else {
            Self::Yes
        }
    }
    fn or(self, other: Self) -> Self {
        if self == Self::Yes || other == Self::Yes {
            Self::Yes
        } else if self == Self::Unknown || other == Self::Unknown {
            Self::Unknown
        } else {
            Self::No
        }
    }
}

#[derive(Clone)]
enum Lex {
    Word(String),
    Number(f64, String, String),
    Colon,
    Comma,
    Op(char),
    Group(Vec<Self>),
    Function(String, Vec<Self>),
    Other(String),
}
fn lex(parser: &mut Parser<'_, '_>, depth: usize) -> std::result::Result<Vec<Lex>, ()> {
    if depth > 32 {
        return Err(());
    }
    let mut output = Vec::new();
    while !parser.is_exhausted() {
        let token = parser.next().map_err(|_parse_error| ())?.clone();
        let css = token.to_css_string();
        let item = match token {
            Token::Ident(word) => Lex::Word(word.to_ascii_lowercase()),
            Token::Number { value, .. } => Lex::Number(f64::from(value), String::new(), css),
            Token::Dimension { value, unit, .. } => Lex::Number(
                f64::from(value),
                unit.to_ascii_lowercase(),
                css.to_ascii_lowercase(),
            ),
            Token::Colon => Lex::Colon,
            Token::Comma => Lex::Comma,
            Token::Delim(character) => Lex::Op(character),
            Token::ParenthesisBlock => {
                let children = parser
                    .parse_nested_block(|nested| {
                        lex(nested, depth.saturating_add(1))
                            .map_err(|()| nested.new_custom_error::<(), ()>(()))
                    })
                    .map_err(|_parse_error| ())?;
                Lex::Group(children)
            }
            Token::Function(name) => {
                let children = parser
                    .parse_nested_block(|nested| {
                        lex(nested, depth.saturating_add(1))
                            .map_err(|()| nested.new_custom_error::<(), ()>(()))
                    })
                    .map_err(|_parse_error| ())?;
                Lex::Function(name.to_string(), children)
            }
            _ => Lex::Other(css),
        };
        output.push(item);
    }
    Ok(output)
}
fn word(token: &Lex, expected: &str) -> bool {
    matches!(token, Lex::Word(value) if value == expected)
}
fn query(tokens: &[Lex], environment: &MediaEnvironment) -> Option<Truth> {
    let (first, rest) = tokens.split_first()?;
    if matches!(first, Lex::Group(_) | Lex::Function(_, _))
        || (word(first, "not") && !matches!(rest.first(), Some(Lex::Word(_))))
    {
        return condition(tokens, environment);
    }
    let (negated, tokens) = if word(first, "not") || word(first, "only") {
        (word(first, "not"), rest)
    } else {
        (false, tokens)
    };
    let (Lex::Word(kind), rest) = tokens.split_first()? else {
        return None;
    };
    if matches!(kind.as_str(), "not" | "only" | "and" | "or") {
        return None;
    }
    let mut value = Truth::from(matches!(kind.as_str(), "all" | "screen"));
    if !rest.is_empty() {
        let (and, tokens) = rest.split_first()?;
        if !word(and, "and") {
            return None;
        }
        // A media type permits only a condition without top-level 'or'.
        if tokens.iter().any(|token| word(token, "or")) {
            return None;
        }
        value = value.and(condition(tokens, environment)?);
    }
    Some(if negated { value.not() } else { value })
}
fn condition(tokens: &[Lex], environment: &MediaEnvironment) -> Option<Truth> {
    if let [not, child] = tokens
        && word(not, "not")
    {
        return Some(operand(child, environment)?.not());
    }
    let (first, mut rest) = tokens.split_first()?;
    let mut value = operand(first, environment)?;
    let mut join = None;
    while !rest.is_empty() {
        let (operator, tail) = rest.split_first()?;
        let (child, tail) = tail.split_first()?;
        let operator = if word(operator, "and") {
            true
        } else if word(operator, "or") {
            false
        } else {
            return None;
        };
        if join.is_some_and(|previous| previous != operator) {
            return None;
        }
        join = Some(operator);
        let child = operand(child, environment)?;
        value = if operator {
            value.and(child)
        } else {
            value.or(child)
        };
        rest = tail;
    }
    Some(value)
}
fn operand(token: &Lex, environment: &MediaEnvironment) -> Option<Truth> {
    match token {
        Lex::Group(tokens) => condition(tokens, environment)
            .or_else(|| feature(tokens, environment))
            .or_else(|| matches!(tokens.first(), Some(Lex::Word(_))).then_some(Truth::Unknown)),
        Lex::Function(_, _) => Some(Truth::Unknown),
        _ => None,
    }
}
fn feature(tokens: &[Lex], environment: &MediaEnvironment) -> Option<Truth> {
    if let [Lex::Word(name)] = tokens {
        if name.starts_with("min-") || name.starts_with("max-") {
            return None;
        }
        return Some(match name.as_str() {
            "width"
            | "height"
            | "aspect-ratio"
            | "orientation"
            | "prefers-color-scheme"
            | "scripting" => Truth::Yes,
            "prefers-reduced-motion" => Truth::from(environment.reduced_motion),
            // No pointing or hover input has been implemented by this engine.
            "pointer" | "any-pointer" | "hover" | "any-hover" => Truth::No,
            _ => Truth::Unknown,
        });
    }
    if let [Lex::Word(name), Lex::Colon, values @ ..] = tokens {
        if values.is_empty() {
            return None;
        }
        let (name, operator) = if let Some(name) = name.strip_prefix("min-") {
            (name, ">=")
        } else if let Some(name) = name.strip_prefix("max-") {
            (name, "<=")
        } else {
            (name.as_str(), "=")
        };
        if let Some(actual) = numeric_feature(name, environment) {
            return Some(
                number(values, name)
                    .map_or(Truth::Unknown, |value| compare(actual, value, operator)),
            );
        }
        if operator != "=" {
            return Some(Truth::Unknown);
        }
        let [Lex::Word(value)] = values else {
            return Some(Truth::Unknown);
        };
        let valid = match name {
            "orientation" => matches!(value.as_str(), "portrait" | "landscape"),
            "prefers-color-scheme" => matches!(value.as_str(), "light" | "dark"),
            "prefers-reduced-motion" => matches!(value.as_str(), "reduce" | "no-preference"),
            "pointer" | "any-pointer" => matches!(value.as_str(), "none" | "coarse" | "fine"),
            "hover" | "any-hover" => matches!(value.as_str(), "none" | "hover"),
            "scripting" => matches!(value.as_str(), "none" | "initial-only" | "enabled"),
            _ => false,
        };
        if !valid {
            return Some(Truth::Unknown);
        }
        let expected = match name {
            "orientation" => {
                if environment.width > environment.height {
                    "landscape"
                } else {
                    "portrait"
                }
            }
            "prefers-color-scheme" => &environment.color_scheme,
            "prefers-reduced-motion" => {
                if environment.reduced_motion {
                    "reduce"
                } else {
                    "no-preference"
                }
            }
            "pointer" | "any-pointer" | "hover" | "any-hover" => "none",
            "scripting" => "enabled",
            _ => return Some(Truth::Unknown),
        };
        return Some(Truth::from(value == expected));
    }
    range_feature(tokens, environment)
}
fn range_feature(tokens: &[Lex], environment: &MediaEnvironment) -> Option<Truth> {
    let mut segments: Vec<Vec<Lex>> = vec![Vec::new()];
    let mut operators: Vec<String> = Vec::new();
    for token in tokens {
        if let Lex::Op(op @ ('<' | '>' | '=')) = token {
            if *op == '='
                && segments.last().is_some_and(Vec::is_empty)
                && operators
                    .last()
                    .is_some_and(|previous| matches!(previous.as_str(), "<" | ">"))
            {
                operators.last_mut()?.push('=');
            } else {
                if segments.last()?.is_empty() {
                    return None;
                }
                operators.push(op.to_string());
                segments.push(Vec::new());
            }
        } else {
            segments.last_mut()?.push(token.clone());
        }
    }
    if !matches!(operators.len(), 1 | 2) || segments.last()?.is_empty() {
        return None;
    }
    let feature_index = segments
        .iter()
        .position(|segment| matches!(segment.as_slice(), [Lex::Word(_)]))?;
    if operators.len() == 2 && feature_index != 1 {
        return None;
    }
    let [Lex::Word(name)] = segments.get(feature_index)?.as_slice() else {
        return None;
    };
    let actual = numeric_feature(name, environment);
    let values = segments
        .iter()
        .map(|segment| {
            if matches!(segment.as_slice(), [Lex::Word(_)]) {
                actual
            } else {
                number(segment, name)
            }
        })
        .collect::<Option<Vec<_>>>();
    if operators.len() == 2 {
        let a = operators.first()?;
        let b = operators.get(1)?;
        if !((a.starts_with('<') && b.starts_with('<'))
            || (a.starts_with('>') && b.starts_with('>')))
        {
            return None;
        }
    }
    let Some(values) = values else {
        return Some(Truth::Unknown);
    };
    let mut result = Truth::Yes;
    for (index, operator) in operators.iter().enumerate() {
        result = result.and(compare(
            *values.get(index)?,
            *values.get(index.saturating_add(1))?,
            operator,
        ));
    }
    Some(result)
}
fn numeric_feature(name: &str, environment: &MediaEnvironment) -> Option<f64> {
    match name {
        "width" => Some(f64::from(environment.width)),
        "height" => Some(f64::from(environment.height)),
        "aspect-ratio" => Some(f64::from(environment.width) / f64::from(environment.height)),
        _ => None,
    }
}
fn number(tokens: &[Lex], feature: &str) -> Option<f64> {
    if let [
        Lex::Number(a, unit, _),
        Lex::Op('/'),
        Lex::Number(b, other, _),
    ] = tokens
    {
        return (feature == "aspect-ratio"
            && unit.is_empty()
            && other.is_empty()
            && *a >= 0.0
            && *b > 0.0)
            .then(|| a / b);
    }
    let [Lex::Number(value, unit, _)] = tokens else {
        return None;
    };
    if feature == "aspect-ratio" {
        return (unit.is_empty() && *value >= 0.0).then_some(*value);
    }
    let scale = match unit.as_str() {
        "px" => 1.0,
        "in" => 96.0,
        "cm" => 96.0 / 2.54,
        "mm" => 96.0 / 25.4,
        "q" => 96.0 / 101.6,
        "pt" => 96.0 / 72.0,
        "pc" => 16.0,
        "" if *value == 0.0 => 1.0,
        _ => return None,
    };
    Some(value * scale)
}
fn compare(a: f64, b: f64, operator: &str) -> Truth {
    Truth::from(match operator {
        "<" => a < b,
        ">" => a > b,
        "<=" => a <= b,
        ">=" => a >= b,
        "=" => (a - b).abs() < 0.000_001,
        _ => false,
    })
}
fn serialize(tokens: &[Lex]) -> String {
    let mut output = String::new();
    for token in tokens {
        match token {
            Lex::Colon => output.push_str(": "),
            Lex::Op('=') if output.ends_with('<') || output.ends_with('>') => output.push('='),
            token => {
                if !output.is_empty() && !output.ends_with(' ') {
                    output.push(' ');
                }
                match token {
                    Lex::Word(value) => {
                        output.push_str(&Token::Ident(value.as_str().into()).to_css_string());
                    }
                    Lex::Number(_, _, value) | Lex::Other(value) => output.push_str(value),
                    Lex::Op(op) => output.push(*op),
                    Lex::Group(children) => {
                        output.push('(');
                        output.push_str(&serialize(children));
                        output.push(')');
                    }
                    Lex::Function(name, children) => {
                        output.push_str(name);
                        output.push('(');
                        output.push_str(&serialize(children));
                        output.push(')');
                    }
                    Lex::Comma => output.push(','),
                    Lex::Colon => {}
                }
            }
        }
    }
    output
}
