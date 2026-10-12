//! Supported non-replaced HTML box categories; special element layout is separate.
use crate::dom_attributes::NativeAttributes;
use crate::{Error, Result, styles::Declarations};
use dom_query::NodeRef;

const BLOCK: [&str; 24] = [
    "html", "body", "div", "main", "section", "article", "aside", "header", "footer", "nav",
    "hgroup", "p", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "form", "dl", "dt", "dd",
];
const INLINE: [&str; 7] = ["span", "a", "abbr", "bdi", "data", "time", "label"];

pub(crate) fn block(node: NodeRef<'_>) -> bool {
    BLOCK.iter().any(|name| node.has_name(name))
}
pub(crate) fn appearance(
    node: NodeRef<'_>,
    value: &str,
    display: taffy::Display,
    generated: bool,
) -> bool {
    if !generated
        && node.has_name("input")
        && matches!(value, "none" | "auto" | "textfield" | "searchfield")
    {
        return true;
    }
    !generated
        && node.has_name("button")
        && matches!(display, taffy::Display::Flex | taffy::Display::Grid)
        && matches!(
            value,
            "auto" | "none" | "button" | "initial" | "unset" | "revert"
        )
}

pub(crate) fn validate(
    node: NodeRef<'_>,
    declarations: &Declarations,
    authored_flex_grid: bool,
    markerless: bool,
    row_flex: bool,
) -> Result<()> {
    // A fully authored flex/grid button uses the author's formatting context.
    // Other native controls and default button rendering remain separate.
    if (node.has_name("button") && authored_flex_grid) || node.has_name("input") {
        if node.has_name("input") {
            let kind = node.null_attribute("type").unwrap_or_default();
            let width = declarations.value("width").0;
            let definite_width = !matches!(width.as_str(), "" | "auto" | "initial" | "unset");
            let allocated_width = row_flex
                && matches!(
                    declarations.value("flex-basis").0.as_str(),
                    "0" | "0px" | "0%"
                )
                && matches!(
                    declarations.value("min-width").0.as_str(),
                    "0" | "0px" | "0%"
                );
            let text = matches!(
                kind.to_ascii_lowercase().as_str(),
                "" | "text" | "search" | "email" | "url" | "tel" | "password"
            );
            let sized_toggle = matches!(kind.to_ascii_lowercase().as_str(), "checkbox" | "radio")
                && definite_width
                && !matches!(
                    declarations.value("height").0.as_str(),
                    "" | "auto" | "initial" | "unset"
                );
            if !(text && (definite_width || allocated_width) || sized_toggle) {
                return Err(Error::Dom(
                    "layout unsupported: input type or intrinsic width".into(),
                ));
            }
        }
        for name in [
            "font-size",
            "font-family",
            "font-weight",
            "font-style",
            "line-height",
            "letter-spacing",
            "box-sizing",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "border-top-width",
            "border-right-width",
            "border-bottom-width",
            "border-left-width",
            "border-top-style",
            "border-right-style",
            "border-bottom-style",
            "border-left-style",
        ] {
            let (value, _) = declarations.value(name);
            if value.is_empty() || matches!(value.as_str(), "revert" | "revert-layer") {
                return Err(Error::Dom(format!(
                    "layout unsupported: {} UA default ({name})",
                    if node.has_name("button") {
                        "button"
                    } else {
                        "input"
                    }
                )));
            }
        }
        return Ok(());
    }
    if node.has_name("ol") || node.has_name("ul") || node.has_name("li") {
        if !(markerless || node.has_name("li") && authored_flex_grid) {
            return Err(Error::Dom("layout unsupported: list marker".into()));
        }
        return Ok(());
    }
    if node.has_name("canvas") || crate::layout::svg_viewport::root(node) {
        return Ok(());
    }
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

/// Authored markerless list paint and wrapping validated by text runs.
pub(crate) fn non_layout(name: &str, value: &str) -> bool {
    match name {
        "text-align" => matches!(value, "left" | "start" | "initial" | "inherit" | "unset"),
        "overflow-wrap" => matches!(
            value,
            "normal" | "break-word" | "anywhere" | "initial" | "unset" | "inherit"
        ),
        "list-style-type" | "list-style-image" => matches!(value, "none" | "inherit" | "unset"),
        "list-style-position" => matches!(value, "inside" | "outside"),
        _ => false,
    }
}

/// Modern HTML heading defaults, before authored declarations.
pub(crate) fn heading_defaults(node: NodeRef<'_>) -> &'static str {
    if node.has_name("h1") {
        "font-size:2em;font-weight:bold;margin-block:.67em"
    } else if node.has_name("h2") {
        "font-size:1.5em;font-weight:bold;margin-block:.83em"
    } else if node.has_name("h3") {
        "font-size:1.17em;font-weight:bold;margin-block:1em"
    } else if node.has_name("h4") {
        "font-size:1em;font-weight:bold;margin-block:1.33em"
    } else if node.has_name("h5") {
        "font-size:.83em;font-weight:bold;margin-block:1.67em"
    } else if node.has_name("h6") {
        "font-size:.67em;font-weight:bold;margin-block:2.33em"
    } else {
        ""
    }
}
