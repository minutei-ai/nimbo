//! Supported non-replaced HTML box categories; special element layout is separate.
use crate::{Error, Result};
use dom_query::NodeRef;

const BLOCK: [&str; 11] = [
    "html", "body", "div", "main", "section", "article", "aside", "header", "footer", "nav",
    "hgroup",
];
const INLINE: [&str; 6] = ["span", "a", "abbr", "bdi", "data", "time"];

pub(crate) fn block(node: NodeRef<'_>) -> bool {
    BLOCK.iter().any(|name| node.has_name(name))
}
pub(crate) fn validate(node: NodeRef<'_>) -> Result<()> {
    let name = node.qual_name_ref();
    let namespace = name.as_ref().map(|name| name.ns.as_ref());
    let detail = if namespace == Some("http://www.w3.org/2000/svg") {
        "element formatting: SVG"
    } else if namespace != Some("http://www.w3.org/1999/xhtml") {
        "element formatting: namespace"
    } else if block(node)
        || INLINE.iter().any(|name| node.has_name(name))
        || name.as_ref().is_some_and(|name| custom_name(&name.local))
    {
        return Ok(());
    } else if [
        "img", "video", "audio", "canvas", "iframe", "object", "embed", "input", "button",
        "select", "textarea",
    ]
    .iter()
    .any(|name| node.has_name(name))
    {
        "element formatting: replaced element or native control"
    } else {
        "element formatting: unsupported HTML tag"
    };
    let tag = name.as_ref().map_or("unknown", |name| name.local.as_ref());
    Err(Error::Dom(format!("layout unsupported: {detail} ({tag})")))
}

fn custom_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && name.contains('-')
        && ![
            "annotation-xml",
            "color-profile",
            "font-face",
            "font-face-src",
            "font-face-uri",
            "font-face-format",
            "font-face-name",
            "missing-glyph",
        ]
        .contains(&name)
        && name.chars().all(|character| {
            matches!(character,
                '-' | '.' | '_' | '0'..='9' | 'a'..='z' | '\u{b7}'
                | '\u{c0}'..='\u{d6}' | '\u{d8}'..='\u{f6}' | '\u{f8}'..='\u{37d}'
                | '\u{37f}'..='\u{1fff}' | '\u{200c}'..='\u{200d}' | '\u{203f}'..='\u{2040}'
                | '\u{2070}'..='\u{218f}' | '\u{2c00}'..='\u{2fef}' | '\u{3001}'..='\u{d7ff}'
                | '\u{f900}'..='\u{fdcf}' | '\u{fdf0}'..='\u{fffd}' | '\u{10000}'..='\u{effff}'
            )
        })
}
