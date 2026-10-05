//! Native syntax for font feature/variation settings; non-default shaping is separate.
use cssparser::{Parser, ParserInput};

pub(crate) fn specified(name: &str, source: &str) -> Option<String> {
    if source.eq_ignore_ascii_case("normal") {
        return Some("normal".into());
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let settings = parser
        .parse_comma_separated(|input| {
            let tag = input.expect_string_cloned()?;
            if tag.len() != 4 || !tag.bytes().all(|byte| (32..=126).contains(&byte)) {
                return Err(input.new_custom_error::<(), ()>(()));
            }
            let mut output = String::new();
            cssparser::serialize_string(&tag, &mut output)
                .map_err(|_error| input.new_custom_error::<(), ()>(()))?;
            if name == "font-variation-settings" {
                let value = input.expect_number()?;
                if !value.is_finite() {
                    return Err(input.new_custom_error::<(), ()>(()));
                }
                output.push(' ');
                output.push_str(&value.to_string());
            } else {
                let value = if input.is_exhausted() {
                    1
                } else if let Ok(value) = input.try_parse(Parser::expect_ident_cloned) {
                    match value.to_ascii_lowercase().as_str() {
                        "on" => 1,
                        "off" => 0,
                        _ => return Err(input.new_custom_error::<(), ()>(())),
                    }
                } else {
                    input.expect_integer()?
                };
                if value < 0 {
                    return Err(input.new_custom_error::<(), ()>(()));
                }
                if value != 1 {
                    output.push(' ');
                    output.push_str(&value.to_string());
                }
            }
            input.expect_exhausted()?;
            Ok(output)
        })
        .ok()?;
    parser.expect_exhausted().ok()?;
    Some(settings.join(", "))
}
