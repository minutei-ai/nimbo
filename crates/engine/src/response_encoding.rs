use encoding_rs::{Encoding, UTF_8};

use crate::{Error, Result};

// HTTP parameter parsing preserves quoted semicolons and escaped characters.
fn charset(content_type: &str) -> Option<String> {
    let mut rest = content_type.split_once(';')?.1;
    while !rest.is_empty() {
        rest = rest.trim_start_matches(|character: char| character.is_ascii_whitespace());
        let end = rest.find(['=', ';']).unwrap_or(rest.len());
        let name = rest.get(..end)?.trim();
        rest = rest.get(end..)?;
        if !rest.starts_with('=') {
            rest = rest.strip_prefix(';').unwrap_or_default();
            continue;
        }
        rest = rest.get(1..)?.trim_start();
        let mut value = String::new();
        if let Some(quoted) = rest.strip_prefix('"') {
            let mut escaped = false;
            let mut consumed = quoted.len();
            for (index, character) in quoted.char_indices() {
                if escaped {
                    value.push(character);
                    escaped = false;
                } else if character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    consumed = index.saturating_add(1);
                    break;
                } else {
                    value.push(character);
                }
            }
            rest = quoted.get(consumed..).unwrap_or_default();
            rest = rest.split_once(';').map_or("", |(_, tail)| tail);
        } else {
            let (parameter, tail) = rest.split_once(';').unwrap_or((rest, ""));
            value.push_str(parameter.trim());
            rest = tail;
        }
        if name.eq_ignore_ascii_case("charset") {
            return Some(value);
        }
    }
    None
}

pub(crate) fn decode(bytes: &[u8], content_type: &str, maximum: usize) -> Result<String> {
    if bytes.len() > maximum {
        return Err(Error::Limit("response bytes"));
    }
    let (encoding, skip) = Encoding::for_bom(bytes).unwrap_or_else(|| {
        let encoding = charset(content_type)
            .and_then(|label| Encoding::for_label(label.as_bytes()))
            .or_else(|| {
                content_type
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/html"))
                    .then(|| crate::response_sniff::html(bytes))
                    .flatten()
            })
            .unwrap_or(UTF_8);
        (encoding, 0)
    });
    let (text, _) = encoding.decode_without_bom_handling(bytes.get(skip..).unwrap_or_default());
    if text.len() > maximum {
        return Err(Error::Limit("decoded response bytes"));
    }
    Ok(text.into_owned())
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn malformed_input_is_replaced_and_both_byte_budgets_are_enforced() -> crate::Result<()> {
        assert_eq!(decode(&[0xff], "text/plain; charset=utf-8", 3)?, "\u{fffd}");
        assert!(matches!(
            decode(&[0xff], "text/plain", 1),
            Err(crate::Error::Limit("decoded response bytes"))
        ));
        assert!(matches!(
            decode(b"abcd", "text/plain", 3),
            Err(crate::Error::Limit("response bytes"))
        ));
        assert_eq!(decode(b"fresh", "text/plain", 5)?, "fresh");
        Ok(())
    }
}
