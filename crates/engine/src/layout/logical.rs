use std::collections::HashMap;

use crate::styles::Declarations;

// This engine currently lays out horizontal-tb, left-to-right boxes only.
pub(crate) fn physical(name: &str) -> &str {
    match name {
        "inline-size" => "width",
        "block-size" => "height",
        "min-inline-size" => "min-width",
        "min-block-size" => "min-height",
        "max-inline-size" => "max-width",
        "max-block-size" => "max-height",
        "margin-inline-start" => "margin-left",
        "margin-inline-end" => "margin-right",
        "margin-block-start" => "margin-top",
        "margin-block-end" => "margin-bottom",
        "padding-inline-start" => "padding-left",
        "padding-inline-end" => "padding-right",
        "padding-block-start" => "padding-top",
        "padding-block-end" => "padding-bottom",
        "inset-inline-start" => "left",
        "inset-inline-end" => "right",
        "inset-block-start" => "top",
        "inset-block-end" => "bottom",
        _ => name,
    }
}

pub(crate) fn group(name: &str) -> Option<&'static str> {
    match physical(name) {
        "width" | "height" => Some("size"),
        "min-width" | "min-height" => Some("min-size"),
        "max-width" | "max-height" => Some("max-size"),
        "margin-left" | "margin-right" | "margin-top" | "margin-bottom" => Some("margin"),
        "padding-left" | "padding-right" | "padding-top" | "padding-bottom" => Some("padding"),
        "left" | "right" | "top" | "bottom" => Some("inset"),
        _ => None,
    }
}

pub(crate) fn entries(declarations: &Declarations) -> Vec<(&str, &str, bool)> {
    let mut winners = HashMap::new();
    for (name, value, deferred, rank) in declarations.layout_priorities() {
        let name = physical(name);
        let winner = winners.entry(name).or_insert((rank, value, deferred));
        if rank >= winner.0 {
            *winner = (rank, value, deferred);
        }
    }
    let mut ordered: Vec<_> = winners.into_iter().collect();
    ordered.sort_by_key(|entry| entry.1.0);
    ordered
        .into_iter()
        .map(|(name, (_, value, deferred))| (name, value, deferred))
        .collect()
}

// Box spacing requires units for nonzero numbers. Padding also excludes auto
// and negative literals. Function ranges are resolved separately.
pub(crate) fn valid_spacing(name: &str, value: &str) -> bool {
    if !spacing(name) {
        return true;
    }
    let padding = name == "padding" || name.starts_with("padding-");
    let mut input = cssparser::ParserInput::new(value);
    let mut parser = cssparser::Parser::new(&mut input);
    while let Ok(token) = parser.next() {
        match token {
            cssparser::Token::Number { value, .. } if *value != 0.0 => return false,
            cssparser::Token::Ident(value) if padding && value.eq_ignore_ascii_case("auto") => {
                return false;
            }
            cssparser::Token::Dimension { value, .. } if padding && *value < 0.0 => {
                return false;
            }
            cssparser::Token::Percentage { unit_value, .. } if padding && *unit_value < 0.0 => {
                return false;
            }
            _ => {}
        }
    }
    true
}

pub(crate) fn spacing(name: &str) -> bool {
    matches!(name, "margin" | "padding" | "inset")
        || name.starts_with("margin-")
        || name.starts_with("padding-")
        || name.starts_with("inset-")
        || matches!(group(name), Some("margin" | "padding" | "inset"))
}
