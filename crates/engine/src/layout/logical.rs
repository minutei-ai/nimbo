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
        _ => name,
    }
}

pub(crate) fn group(name: &str) -> Option<&'static str> {
    match physical(name) {
        "width" | "height" => Some("size"),
        "min-width" | "min-height" => Some("min-size"),
        "max-width" | "max-height" => Some("max-size"),
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
