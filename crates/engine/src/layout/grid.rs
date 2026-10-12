//! Contextual, bounded explicit grid tracks and numeric placement.
use super::{Work, lengths, unsupported};
use crate::{Result, fonts::Context};
use lightningcss::{
    properties::grid::{
        RepeatCount, TrackBreadth, TrackListItem, TrackSize, TrackSizeList, TrackSizing,
    },
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
};
use taffy::{
    Style,
    style::{
        GridPlacement, GridTemplateComponent, GridTemplateRepetition, RepetitionCount,
        TrackSizingFunction,
    },
};

const MAX_TRACKS: usize = 256;
fn breadth(value: &TrackBreadth, fonts: &Context, work: &mut Work<'_>) -> Result<String> {
    work.charge()?;
    let css = value
        .to_css_string(PrinterOptions::default())
        .map_err(|_error| unsupported("grid track"))?;
    if matches!(value, TrackBreadth::Length(_)) {
        Ok(lengths::value("width", &css, fonts, work)?.into_owned())
    } else {
        Ok(css)
    }
}
fn track(value: &TrackSize, fonts: &Context, work: &mut Work<'_>) -> Result<TrackSizingFunction> {
    let css = match value {
        TrackSize::TrackBreadth(value) => breadth(value, fonts, work)?,
        TrackSize::MinMax { min, max } => format!(
            "minmax({}, {})",
            breadth(min, fonts, work)?,
            breadth(max, fonts, work)?
        ),
        TrackSize::FitContent(value) => {
            let css = value
                .to_css_string(PrinterOptions::default())
                .map_err(|_error| unsupported("grid track"))?;
            format!(
                "fit-content({})",
                lengths::value("width", &css, fonts, work)?
            )
        }
    };
    css.parse().map_err(|_error| unsupported("grid track"))
}
fn tracks(
    value: &str,
    fonts: &Context,
    work: &mut Work<'_>,
) -> Result<Vec<GridTemplateComponent<String>>> {
    let parsed = TrackSizing::parse_string(value).map_err(|_error| unsupported("grid template"))?;
    let TrackSizing::TrackList(list) = parsed else {
        return Ok(Vec::new());
    };
    if list.line_names.iter().any(|names| !names.is_empty()) {
        return Err(unsupported("named grid lines"));
    }
    let mut total = 0usize;
    let mut out = Vec::new();
    for item in list.items {
        match item {
            TrackListItem::TrackSize(size) => {
                total = total.saturating_add(1);
                out.push(GridTemplateComponent::Single(track(&size, fonts, work)?));
            }
            TrackListItem::TrackRepeat(repeat) => {
                if repeat.line_names.iter().any(|names| !names.is_empty()) {
                    return Err(unsupported("named grid lines"));
                }
                let n = match repeat.count {
                    RepeatCount::Number(n) if (1..=256).contains(&n) => {
                        u16::try_from(n).map_err(|_error| unsupported("grid track limit"))?
                    }
                    RepeatCount::AutoFit | RepeatCount::AutoFill => {
                        return Err(unsupported("automatic grid repetition"));
                    }
                    RepeatCount::Number(_) => return Err(unsupported("grid track limit")),
                };
                let count = RepetitionCount::Count(n);
                total =
                    total.saturating_add(usize::from(n).saturating_mul(repeat.track_sizes.len()));
                if total > MAX_TRACKS {
                    return Err(unsupported("grid track limit"));
                }
                let sizes = repeat
                    .track_sizes
                    .iter()
                    .map(|size| track(size, fonts, work))
                    .collect::<Result<Vec<_>>>()?;
                out.push(GridTemplateComponent::Repeat(GridTemplateRepetition {
                    count,
                    tracks: sizes,
                    line_names: Vec::new(),
                }));
            }
        }
        if total > MAX_TRACKS {
            return Err(unsupported("grid track limit"));
        }
    }
    Ok(out)
}
fn placement(value: &str) -> Result<GridPlacement<String>> {
    let parsed: GridPlacement<String> = value
        .parse()
        .map_err(|_error| unsupported("grid placement"))?;
    match &parsed {
        GridPlacement::Auto => {}
        GridPlacement::Line(line) if i32::from(line.as_i16()).unsigned_abs() <= 256 => {}
        GridPlacement::Span(n) if *n > 0 && usize::from(*n) <= MAX_TRACKS => {}
        _ => return Err(unsupported("named or overlarge grid placement")),
    }
    Ok(parsed)
}
pub(super) fn apply(
    style: &mut Style,
    name: &str,
    value: &str,
    fonts: &Context,
    work: &mut Work<'_>,
) -> Result<bool> {
    let value = if matches!(value, "initial" | "unset") {
        if name.starts_with("grid-template-") {
            "none"
        } else {
            "auto"
        }
    } else {
        value
    };
    match name {
        "grid-template-columns" => style.grid_template_columns = tracks(value, fonts, work)?,
        "grid-template-rows" => style.grid_template_rows = tracks(value, fonts, work)?,
        "grid-auto-columns" | "grid-auto-rows" => {
            let list = TrackSizeList::parse_string(value).map_err(|_error| unsupported(name))?;
            if list.0.len() > MAX_TRACKS {
                return Err(unsupported("grid track limit"));
            }
            let sizes = list
                .0
                .iter()
                .map(|size| track(size, fonts, work))
                .collect::<Result<Vec<_>>>()?;
            if name == "grid-auto-columns" {
                style.grid_auto_columns = sizes;
            } else {
                style.grid_auto_rows = sizes;
            }
        }
        "grid-column-start" => style.grid_column.start = placement(value)?,
        "grid-column-end" => style.grid_column.end = placement(value)?,
        "grid-row-start" => style.grid_row.start = placement(value)?,
        "grid-row-end" => style.grid_row.end = placement(value)?,
        _ => return Ok(false),
    }
    work.charge()?;
    Ok(true)
}
