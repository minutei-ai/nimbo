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
    } else if block(node) || INLINE.iter().any(|name| node.has_name(name)) {
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
    Err(Error::Dom(format!("layout unsupported: {detail}")))
}
