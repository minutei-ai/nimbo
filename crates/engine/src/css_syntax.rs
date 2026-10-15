use cssparser::{ParseError, Parser, Token};

pub(crate) fn consume<'i>(
    input: &mut Parser<'i, '_>,
    depth: usize,
) -> Result<bool, ParseError<'i, &'static str>> {
    if depth > 32 {
        return Err(input.new_custom_error("stylesheet nesting"));
    }
    let mut curly = false;
    while !input.is_exhausted() {
        match input.next_including_whitespace_and_comments()?.clone() {
            Token::CurlyBracketBlock => {
                curly = true;
                input.parse_nested_block(|input| consume(input, depth.saturating_add(1)))?;
            }
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock => {
                curly |=
                    input.parse_nested_block(|input| consume(input, depth.saturating_add(1)))?;
            }
            _ => {}
        }
    }
    Ok(curly)
}
