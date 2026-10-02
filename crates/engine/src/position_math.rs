//! Parse positioning math without discarding percentage-reference provenance.
use crate::{
    Error, Result,
    fonts::Context,
    layout::Work,
    position_value::{Value, function_value},
};
use cssparser::{ParseError, ParseErrorKind, Parser, ParserInput, Token};
use lightningcss::{traits::Parse, values::length::LengthPercentage};

type Parsed<'i, T> = std::result::Result<T, ParseError<'i, Error>>;
enum Term {
    Number(f64),
    Length(Value),
}

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: background position {detail}"))
}
fn finite(value: f64) -> Result<f64> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(unsupported("non-finite value"))
    }
}

pub(crate) fn parse(
    source: &str,
    fonts: &Context,
    work: &mut Work<'_>,
    preserve: bool,
) -> Result<Value> {
    let mut source = ParserInput::new(source);
    let mut input = Parser::new(&mut source);
    let result = input.parse_entirely(|input| expression(input, fonts, work, preserve, 0));
    match result {
        Ok(Term::Length(value)) => Ok(value),
        Ok(Term::Number(0.0)) => Ok(Value::pixels(0.0)),
        Ok(Term::Number(_)) => Err(unsupported("dimensionless calculation")),
        Err(error) => match error.kind {
            ParseErrorKind::Custom(error) => Err(error),
            ParseErrorKind::Basic(_) => Err(unsupported("math syntax")),
        },
    }
}

fn expression<'i>(
    input: &mut Parser<'i, '_>,
    fonts: &Context,
    work: &mut Work<'_>,
    preserve: bool,
    depth: usize,
) -> Parsed<'i, Term> {
    let mut value = product(input, fonts, work, preserve, depth)?;
    loop {
        let negative = if input.try_parse(|input| input.expect_delim('+')).is_ok() {
            false
        } else if input.try_parse(|input| input.expect_delim('-')).is_ok() {
            true
        } else {
            break;
        };
        let next = product(input, fonts, work, preserve, depth)?;
        value = match (value, next) {
            (Term::Number(a), Term::Number(b)) => Term::Number(
                finite(a + if negative { -b } else { b })
                    .map_err(|error| input.new_custom_error(error))?,
            ),
            (Term::Length(a), Term::Length(b)) => Term::Length(
                a.add(
                    if negative { b.multiply(-1.0) } else { Ok(b) }
                        .map_err(|error| input.new_custom_error(error))?,
                )
                .map_err(|error| input.new_custom_error(error))?,
            ),
            _ => return Err(input.new_custom_error(unsupported("math dimension"))),
        };
    }
    Ok(value)
}

fn product<'i>(
    input: &mut Parser<'i, '_>,
    fonts: &Context,
    work: &mut Work<'_>,
    preserve: bool,
    depth: usize,
) -> Parsed<'i, Term> {
    let mut value = primary(input, fonts, work, preserve, depth)?;
    loop {
        let divide = if input.try_parse(|input| input.expect_delim('*')).is_ok() {
            false
        } else if input.try_parse(|input| input.expect_delim('/')).is_ok() {
            true
        } else {
            break;
        };
        let next = primary(input, fonts, work, preserve, depth)?;
        value = match (value, next) {
            (Term::Number(a), Term::Number(b)) => Term::Number(
                finite(if divide { a / b } else { a * b })
                    .map_err(|error| input.new_custom_error(error))?,
            ),
            (Term::Length(a), Term::Number(b)) => Term::Length(
                a.multiply(if divide { 1.0 / b } else { b })
                    .map_err(|error| input.new_custom_error(error))?,
            ),
            (Term::Number(a), Term::Length(b)) if !divide => Term::Length(
                b.multiply(a)
                    .map_err(|error| input.new_custom_error(error))?,
            ),
            _ => return Err(input.new_custom_error(unsupported("math dimension"))),
        };
    }
    Ok(value)
}

fn primary<'i>(
    input: &mut Parser<'i, '_>,
    fonts: &Context,
    work: &mut Work<'_>,
    preserve: bool,
    depth: usize,
) -> Parsed<'i, Term> {
    work.charge()
        .map_err(|error| input.new_custom_error(error))?;
    if depth > 32 {
        return Err(input.new_custom_error(Error::Limit("background position nesting")));
    }
    let next = depth.saturating_add(1);
    let start = input.position();
    match input.next()?.clone() {
        Token::Number { value, .. } => Ok(Term::Number(
            finite(f64::from(value)).map_err(|error| input.new_custom_error(error))?,
        )),
        Token::Dimension { .. } | Token::Percentage { .. } => {
            let value = LengthPercentage::parse_string(input.slice_from(start).trim())
                .map_err(|_error| input.new_custom_error(unsupported("math literal")))?;
            Ok(Term::Length(
                Value::literal(&value, fonts, work)
                    .map_err(|error| input.new_custom_error(error))?,
            ))
        }
        Token::ParenthesisBlock => {
            input.parse_nested_block(|input| expression(input, fonts, work, preserve, next))
        }
        Token::Function(name) if name.eq_ignore_ascii_case("calc") => {
            input.parse_nested_block(|input| expression(input, fonts, work, preserve, next))
        }
        Token::Function(name) => {
            let name = match name.to_ascii_lowercase().as_str() {
                "min" => "min",
                "max" => "max",
                "clamp" => "clamp",
                _ => return Err(input.new_custom_error(unsupported("math function"))),
            };
            let terms = input.parse_nested_block(|input| {
                input.parse_comma_separated(|input| expression(input, fonts, work, preserve, next))
            })?;
            apply(name, terms, preserve).map_err(|error| input.new_custom_error(error))
        }
        Token::Ident(name) if name.eq_ignore_ascii_case("pi") => {
            Ok(Term::Number(std::f64::consts::PI))
        }
        Token::Ident(name) if name.eq_ignore_ascii_case("e") => {
            Ok(Term::Number(std::f64::consts::E))
        }
        Token::Ident(_) => Err(input.new_custom_error(unsupported("non-finite value"))),
        _ => Err(input.new_custom_error(unsupported("math syntax"))),
    }
}

fn apply(name: &'static str, terms: Vec<Term>, preserve: bool) -> Result<Term> {
    if name == "clamp" && terms.len() != 3 {
        return Err(unsupported("clamp arguments"));
    }
    let numeric = terms.iter().all(|term| matches!(term, Term::Number(_)));
    let values = terms
        .into_iter()
        .map(|term| match term {
            Term::Number(value) if numeric => Ok(Value::pixels(value)),
            Term::Length(value) if !numeric => Ok(value),
            _ => Err(unsupported("math dimension")),
        })
        .collect::<Result<Vec<_>>>()?;
    let value = function_value(name, values, preserve)?;
    match value {
        Value::Linear {
            percent: None,
            pixels,
        } if numeric => Ok(Term::Number(pixels)),
        _ if !numeric => Ok(Term::Length(value)),
        _ => Err(unsupported("math dimension")),
    }
}
