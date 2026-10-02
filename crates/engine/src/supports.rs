use crate::{Error, Result, styles::Declarations};
use cssparser::{
    BasicParseErrorKind, Delimiter, ParseError, Parser, ParserInput, Token, parse_important,
};

type QueryError<'i> = ParseError<'i, &'static str>;

fn syntax<'i>(input: &Parser<'i, '_>) -> QueryError<'i> {
    input.new_error(BasicParseErrorKind::QualifiedRuleInvalid)
}

fn consume<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
) -> std::result::Result<(), QueryError<'i>> {
    if depth > 32 {
        return Err(input.new_custom_error("supports nesting"));
    }
    while !input.is_exhausted() {
        match input.next()?.clone() {
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                input.parse_nested_block(|nested| consume(nested, depth.saturating_add(1)))?;
            }
            Token::BadString(_) | Token::BadUrl(_) => return Err(syntax(input)),
            _ => {}
        }
    }
    Ok(())
}

fn declaration<'i>(input: &mut Parser<'i, '_>) -> std::result::Result<bool, QueryError<'i>> {
    let name = input.expect_ident_cloned()?;
    input.expect_colon()?;
    let start = input.position();
    input.parse_until_before(Delimiter::Bang | Delimiter::Semicolon, |value| {
        consume(value, 0)
    })?;
    let value = input.slice_from(start).to_owned();
    let _important = input.try_parse(parse_important);
    input.expect_exhausted()?;
    Ok(Declarations::supported(&name, &value))
}

fn operand<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
) -> std::result::Result<bool, QueryError<'i>> {
    match input.next()?.clone() {
        Token::ParenthesisBlock => input.parse_nested_block(|nested| {
            if let Ok(result) =
                nested.try_parse(|nested| condition(nested, depth.saturating_add(1)))
            {
                return Ok(result);
            }
            if let Ok(result) = nested.try_parse(declaration) {
                return Ok(result);
            }
            nested.expect_ident()?;
            consume(nested, depth.saturating_add(1))?;
            Ok(false)
        }),
        Token::Function(_) => input.parse_nested_block(|nested| {
            consume(nested, depth.saturating_add(1))?;
            Ok(false)
        }),
        _ => Err(syntax(input)),
    }
}

pub(crate) fn condition<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
) -> std::result::Result<bool, QueryError<'i>> {
    if depth > 32 {
        return Err(input.new_custom_error("supports nesting"));
    }
    if input
        .try_parse(|input| input.expect_ident_matching("not"))
        .is_ok()
    {
        let result = operand(input, depth)?;
        input.expect_exhausted()?;
        return Ok(!result);
    }
    let mut result = operand(input, depth)?;
    let mut operation = None;
    while !input.is_exhausted() {
        let operator = input.expect_ident_cloned()?;
        let and = if operator.eq_ignore_ascii_case("and") {
            true
        } else if operator.eq_ignore_ascii_case("or") {
            false
        } else {
            return Err(syntax(input));
        };
        if operation.is_some_and(|old| old != and) {
            return Err(syntax(input));
        }
        operation = Some(and);
        let next = operand(input, depth)?;
        result = if and { result && next } else { result || next };
    }
    Ok(result)
}

pub(crate) fn query(source: &str) -> Result<bool> {
    if source.len() > 65_536 {
        return Err(Error::Limit("supports bytes"));
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    if let Err(error) = consume(&mut parser, 0) {
        return if matches!(
            error.kind,
            cssparser::ParseErrorKind::Custom("supports nesting")
        ) {
            Err(Error::Limit("supports nesting"))
        } else {
            Ok(false)
        };
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    if let Ok(result) = parser.try_parse(|parser| condition(parser, 0)) {
        return Ok(result);
    }
    Ok(parser.try_parse(declaration).unwrap_or(false))
}

pub(crate) fn value(name: &str, source: &str) -> Result<bool> {
    if source.is_empty() {
        return Ok(false);
    }
    if name.len().saturating_add(source.len()) > 65_536 {
        return Err(Error::Limit("supports bytes"));
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    if let Err(error) = parser.parse_until_before(Delimiter::Bang | Delimiter::Semicolon, |input| {
        consume(input, 0)
    }) {
        return if matches!(
            error.kind,
            cssparser::ParseErrorKind::Custom("supports nesting")
        ) {
            Err(Error::Limit("supports nesting"))
        } else {
            Ok(false)
        };
    }
    if !parser.is_exhausted() {
        return Ok(false);
    }
    Ok(Declarations::supported(name, source))
}
