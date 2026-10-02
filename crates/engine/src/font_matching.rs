use std::{cmp::Ordering, collections::BTreeSet};

use cssparser::{Parser, ParserInput};
use icu_casemap::CaseMapper;
use lightningcss::{
    properties::font::{AbsoluteFontWeight, Font, FontFamily, FontStretch, FontWeight},
    rules::font_face::{FontStyle, UnicodeRange},
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::{percentage::Percentage, size::Size2D},
};
use rquickjs::{Ctx, Exception, Function};
use serde::Deserialize;

use crate::{Error, Result};

type Score = (u8, f64);
type Rank = [Score; 3];

#[derive(Deserialize)]
struct Description {
    family: String,
    style: String,
    weight: String,
    stretch: String,
    range: String,
}
#[derive(Deserialize)]
struct Request {
    font: String,
    text: Vec<u16>,
    faces: Vec<Description>,
}
struct Face {
    family: String,
    style: Style,
    weight: [f64; 2],
    width: [f64; 2],
    range: Vec<UnicodeRange>,
}
#[derive(Clone, Copy)]
enum Style {
    Normal,
    Italic,
    Oblique([f64; 2]),
}

fn unsupported() -> Error {
    Error::Dom("font matching unsupported descriptor".into())
}
fn folded(source: &str) -> String {
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let name = parser
        .try_parse(|parser| {
            let name = parser.expect_string_cloned()?.to_string();
            parser.expect_exhausted()?;
            Ok::<_, cssparser::BasicParseError<'_>>(name)
        })
        .unwrap_or_else(|_error| source.to_owned());
    // CSS family matching folds case without Unicode normalization or locale rules.
    CaseMapper::new().fold_string(&name).into_owned()
}
fn weight(value: &FontWeight, relative: bool) -> Result<f64> {
    let value = match value {
        FontWeight::Absolute(AbsoluteFontWeight::Normal) => 400.0,
        FontWeight::Absolute(AbsoluteFontWeight::Bold) => 700.0,
        FontWeight::Absolute(AbsoluteFontWeight::Weight(value)) => f64::from(*value),
        FontWeight::Bolder if relative => 700.0,
        FontWeight::Lighter if relative => 100.0,
        _ => return Err(unsupported()),
    };
    if !(1.0..=1000.0).contains(&value) {
        return Err(unsupported());
    }
    Ok(value)
}
fn width(value: &FontStretch) -> Result<f64> {
    let value: Percentage = value.into();
    let value = f64::from(value.0);
    if !value.is_finite() || value < 0.0 {
        return Err(unsupported());
    }
    Ok(value)
}
fn interval(first: f64, second: f64) -> Result<[f64; 2]> {
    if first > second || !first.is_finite() || !second.is_finite() {
        return Err(unsupported());
    }
    Ok([first, second])
}
fn style(source: &str) -> Result<Style> {
    match FontStyle::parse_string(source).map_err(|_error| unsupported())? {
        FontStyle::Normal => Ok(Style::Normal),
        FontStyle::Italic => Ok(Style::Italic),
        FontStyle::Oblique(Size2D(first, second)) => {
            let first = f64::from(first.to_degrees());
            let second = f64::from(second.to_degrees());
            if !(-90.0..=90.0).contains(&first) || !(-90.0..=90.0).contains(&second) {
                return Err(unsupported());
            }
            Ok(Style::Oblique(interval(first, second)?))
        }
    }
}
impl Face {
    fn parse(value: &Description) -> Result<Self> {
        let weight_range =
            Size2D::<FontWeight>::parse_string(&value.weight).map_err(|_error| unsupported())?;
        let width_range =
            Size2D::<FontStretch>::parse_string(&value.stretch).map_err(|_error| unsupported())?;
        Ok(Self {
            family: folded(&value.family),
            style: style(&value.style)?,
            weight: interval(
                weight(&weight_range.0, false)?,
                weight(&weight_range.1, false)?,
            )?,
            width: interval(width(&width_range.0)?, width(&width_range.1)?)?,
            range: Vec::<UnicodeRange>::parse_string(&value.range)
                .map_err(|_error| unsupported())?,
        })
    }
    fn covers(&self, points: &BTreeSet<u32>) -> bool {
        self.range
            .iter()
            .any(|range| points.range(range.start..=range.end).next().is_some())
    }
    fn same_group(&self, other: &Self) -> bool {
        same_range(self.width, other.width)
            && same_range(self.weight, other.weight)
            && match (self.style, other.style) {
                (Style::Normal, Style::Normal) | (Style::Italic, Style::Italic) => true,
                (Style::Oblique(a), Style::Oblique(b)) => same_range(a, b),
                _ => false,
            }
    }
    fn specificity(&self) -> [f64; 3] {
        let angle = match self.style {
            Style::Oblique([a, b]) => b - a,
            _ => 0.0,
        };
        [span(self.width), angle, span(self.weight)]
    }
    fn rank(&self, width: f64, style: Style, weight: f64) -> Rank {
        [
            direction(width, self.width, width > 1.0),
            style_score(style, self.style),
            weight_score(weight, self.weight),
        ]
    }
}
fn span([low, high]: [f64; 2]) -> f64 {
    high - low
}
fn same_range([a, b]: [f64; 2], [c, d]: [f64; 2]) -> bool {
    a.total_cmp(&c) == Ordering::Equal && b.total_cmp(&d) == Ordering::Equal
}
fn compare_specificity(first: &Face, second: &Face) -> Ordering {
    first
        .specificity()
        .iter()
        .zip(second.specificity())
        .map(|(a, b)| a.total_cmp(&b))
        .find(|order| *order != Ordering::Equal)
        .unwrap_or(Ordering::Equal)
}
fn compare(first: &Score, second: &Score) -> Ordering {
    first
        .0
        .cmp(&second.0)
        .then_with(|| first.1.total_cmp(&second.1))
}
fn compare_rank(first: &Rank, second: &Rank) -> Ordering {
    first
        .iter()
        .zip(second)
        .map(|(a, b)| compare(a, b))
        .find(|order| *order != Ordering::Equal)
        .unwrap_or(Ordering::Equal)
}
fn direction(target: f64, [low, high]: [f64; 2], above: bool) -> Score {
    if (low..=high).contains(&target) {
        return (0, 0.0);
    }
    if low > target {
        (if above { 1 } else { 2 }, low - target)
    } else {
        (if above { 2 } else { 1 }, target - high)
    }
}
fn weight_score(target: f64, range: [f64; 2]) -> Score {
    if !(400.0..=500.0).contains(&target) {
        return direction(target, range, target > 500.0);
    }
    let [low, high] = range;
    if (low..=high).contains(&target) {
        (0, 0.0)
    } else if low > target && low <= 500.0 {
        (1, low - target)
    } else if high < target {
        (2, target - high)
    } else {
        (3, low - 500.0)
    }
}
fn positive_angle(target: f64, range: [f64; 2], high_first: bool) -> Score {
    let [low, high] = range;
    if high <= 0.0 {
        return (4, -high);
    }
    direction(target, [low.max(0.0), high], high_first)
}
fn style_score(target: Style, face: Style) -> Score {
    match target {
        Style::Normal => match face {
            Style::Normal => (0, 0.0),
            Style::Italic => (2, 0.0),
            Style::Oblique([low, high]) if high >= 0.0 => (1, low.max(0.0)),
            Style::Oblique([_, high]) => (3, -high),
        },
        Style::Italic => match face {
            Style::Italic => (0, 0.0),
            Style::Normal => (4, 0.0),
            Style::Oblique(range) => {
                let rank = positive_angle(11.0, range, true);
                (rank.0.saturating_add(1), rank.1)
            }
        },
        Style::Oblique([angle, _]) => match face {
            Style::Normal => (5, 0.0),
            Style::Italic => (if angle < 0.0 { 6 } else { 3 }, 0.0),
            Style::Oblique([low, high]) => {
                if angle < 0.0 {
                    positive_angle(-angle, [-high, -low], angle <= -11.0)
                } else {
                    positive_angle(angle, [low, high], angle >= 11.0)
                }
            }
        },
    }
}
fn select(request: &Request) -> Result<Option<Vec<usize>>> {
    if request.font.len() > 4096 || request.text.len() > 65536 || request.faces.len() > 1024 {
        return Err(Error::Limit("font matching input"));
    }
    if !crate::font_faces::guarded(&request.font) {
        return Ok(None);
    }
    let Ok(font) = Font::parse_string(&request.font) else {
        return Ok(None);
    };
    let style_source = font
        .style
        .to_css_string(PrinterOptions::default())
        .map_err(|_error| unsupported())?;
    let target_style = style(&style_source)?;
    let target_weight = weight(&font.weight, true)?;
    let target_width = width(&font.stretch)?;
    let faces = request
        .faces
        .iter()
        .map(Face::parse)
        .collect::<Result<Vec<_>>>()?;
    let points = char::decode_utf16(request.text.iter().copied())
        .map(|character| {
            character.map_or_else(|error| u32::from(error.unpaired_surrogate()), u32::from)
        })
        .collect::<BTreeSet<_>>();
    let mut selected = Vec::new();
    for family in &font.family {
        if matches!(family, FontFamily::Generic(_)) {
            continue;
        }
        let name = family
            .to_css_string(PrinterOptions::default())
            .map_err(|_error| unsupported())?;
        let name = folded(&name);
        let candidates = faces
            .iter()
            .enumerate()
            .filter(|(_, face)| face.family == name)
            .map(|(index, face)| {
                (
                    index,
                    face,
                    face.rank(target_width, target_style, target_weight),
                )
            })
            .collect::<Vec<_>>();
        // A tie between distinct descriptor groups must choose one consistent face.
        // Prefer narrower intervals; preserve set order if their specificity is equal.
        let best = candidates.iter().min_by(|(_, a, ar), (_, b, br)| {
            compare_rank(ar, br).then_with(|| compare_specificity(a, b))
        });
        if let Some((_, best, _)) = best {
            for (index, face, _) in &candidates {
                if face.same_group(best) && face.covers(&points) {
                    selected.push(*index);
                }
            }
        }
    }
    Ok(Some(selected))
}
pub(crate) fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "nimboFontMatch",
        Function::new(ctx.clone(), |ctx: Ctx<'_>, input: String| {
            if input.len() > 1_048_576 {
                return Err(Exception::throw_message(
                    &ctx,
                    "font matching payload limit",
                ));
            }
            let request: Request = serde_json::from_str(&input)
                .map_err(|error| Exception::throw_type(&ctx, &error.to_string()))?;
            let selected = select(&request)
                .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?;
            serde_json::to_string(&selected)
                .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
        })?,
    )
}
