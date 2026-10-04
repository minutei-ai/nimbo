use std::collections::HashMap;

use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE, WINDOWS_1252, X_USER_DEFINED};

fn whitespace(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{c}' | '\r' | ' ')
}

fn attribute(rest: &str) -> Option<(String, String, &str)> {
    let rest = rest.trim_start_matches(|character| whitespace(character) || character == '/');
    if rest.is_empty() || rest.starts_with('>') {
        return None;
    }
    let end = rest
        .find(|character| whitespace(character) || matches!(character, '=' | '>' | '/'))
        .unwrap_or(rest.len());
    let name = rest.get(..end)?.to_ascii_lowercase();
    let tail = rest.get(end..)?.trim_start_matches(whitespace);
    let Some(value) = tail.strip_prefix('=') else {
        return Some((name, String::new(), tail));
    };
    let value = value.trim_start_matches(whitespace);
    if let Some(quote) = value
        .chars()
        .next()
        .filter(|character| matches!(character, '\'' | '"'))
    {
        let value = value.get(1..)?;
        let end = value.find(quote)?;
        return Some((
            name,
            value.get(..end)?.to_ascii_lowercase(),
            value.get(end.saturating_add(1)..)?,
        ));
    }
    let end = value
        .find(|character| whitespace(character) || character == '>')
        .unwrap_or(value.len());
    Some((
        name,
        value.get(..end)?.to_ascii_lowercase(),
        value.get(end..)?,
    ))
}

fn meta(attributes: &HashMap<String, String>) -> Option<&'static Encoding> {
    let label = if let Some(label) = attributes.get("charset") {
        label.clone()
    } else if attributes
        .get("http-equiv")
        .is_some_and(|value| value == "content-type")
    {
        let content = attributes.get("content")?;
        let rest = content
            .get(content.find("charset")?.saturating_add(7)..)?
            .trim_start_matches(whitespace);
        let rest = rest.strip_prefix('=')?.trim_start_matches(whitespace);
        if let Some(quote) = rest
            .chars()
            .next()
            .filter(|character| matches!(character, '\'' | '"'))
        {
            let rest = rest.get(1..)?;
            rest.get(..rest.find(quote)?)?.to_owned()
        } else {
            rest.split(|character| whitespace(character) || character == ';')
                .next()?
                .to_owned()
        }
    } else {
        return None;
    };
    let encoding = Encoding::for_label(label.as_bytes())?;
    Some(if encoding == UTF_16BE || encoding == UTF_16LE {
        UTF_8
    } else if encoding == X_USER_DEFINED {
        WINDOWS_1252
    } else {
        encoding
    })
}

pub(crate) fn html(bytes: &[u8]) -> Option<&'static Encoding> {
    let prefix: String = bytes
        .iter()
        .take(1024)
        .map(|byte| char::from(*byte))
        .collect();
    let mut rest = prefix.as_str();
    while let Some(index) = rest.find('<') {
        rest = rest.get(index..)?;
        if rest.starts_with("<!--") {
            rest = rest.get(rest.find("-->")?.saturating_add(3)..)?;
            continue;
        }
        let tag = rest.get(1..)?;
        if tag.starts_with(['!', '?', '/']) {
            rest = tag.get(tag.find('>')?.saturating_add(1)..)?;
            continue;
        }
        if !tag.starts_with(|character: char| character.is_ascii_alphabetic()) {
            rest = tag;
            continue;
        }
        let end = tag.find(|character| whitespace(character) || matches!(character, '/' | '>'))?;
        let name = tag.get(..end)?;
        rest = tag.get(end..)?;
        let mut attributes = HashMap::new();
        loop {
            rest = rest.trim_start_matches(|character| whitespace(character) || character == '/');
            let Some((name, value, tail)) = attribute(rest) else {
                break;
            };
            attributes.entry(name).or_insert(value);
            rest = tail;
        }
        if !rest.starts_with('>') {
            return None;
        }
        if name.eq_ignore_ascii_case("meta")
            && let Some(encoding) = meta(&attributes)
        {
            return Some(encoding);
        }
        rest = rest.get(1..)?;
    }
    None
}
