//! Deterministic, public Liberation 2.1.5 font profile; parsed lazily per face.
use crate::{Error, Result};
use harfrust::Font;
use lightningcss::{
    properties::font::{
        AbsoluteFontWeight, Font as CssFont, FontFamily, FontStyle, FontWeight, GenericFontFamily,
    },
    traits::{Parse, ToCss},
};
use std::sync::OnceLock;

macro_rules! source {
    ($name:literal) => {{
        const CONTENT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/fonts/", $name));
        CONTENT
    }};
}
const SOURCES: [&[u8]; 12] = [
    source!("LiberationSerif-Regular.ttf"),
    source!("LiberationSerif-Bold.ttf"),
    source!("LiberationSerif-Italic.ttf"),
    source!("LiberationSerif-BoldItalic.ttf"),
    source!("LiberationSans-Regular.ttf"),
    source!("LiberationSans-Bold.ttf"),
    source!("LiberationSans-Italic.ttf"),
    source!("LiberationSans-BoldItalic.ttf"),
    source!("LiberationMono-Regular.ttf"),
    source!("LiberationMono-Bold.ttf"),
    source!("LiberationMono-Italic.ttf"),
    source!("LiberationMono-BoldItalic.ttf"),
];
static FONTS: [OnceLock<std::result::Result<Font, &'static str>>; 12] =
    [const { OnceLock::new() }; 12];
fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}
fn family(value: &FontFamily<'_>) -> Result<Option<usize>> {
    match value {
        FontFamily::Generic(generic) => match generic {
            GenericFontFamily::Serif | GenericFontFamily::UISerif => Ok(Some(0)),
            GenericFontFamily::SansSerif
            | GenericFontFamily::UISansSerif
            | GenericFontFamily::SystemUI => Ok(Some(4)),
            GenericFontFamily::Monospace | GenericFontFamily::UIMonospace => Ok(Some(8)),
            _ => Err(unsupported("builtin generic font family")),
        },
        FontFamily::FamilyName(name) => Ok(
            match name
                .to_css_string(lightningcss::stylesheet::PrinterOptions::default())
                .map_err(|_error| unsupported("builtin font family syntax"))?
                .to_ascii_lowercase()
                .as_str()
            {
                "times new roman" | "times" | "liberation serif" => Some(0),
                "arial" | "helvetica" | "liberation sans" => Some(4),
                "courier new" | "courier" | "liberation mono" => Some(8),
                _ => None,
            },
        ),
    }
}
pub(crate) fn select(source: &str) -> Result<Font> {
    let request =
        CssFont::parse_string(source).map_err(|_error| unsupported("builtin font syntax"))?;
    let weight = match request.weight {
        FontWeight::Absolute(AbsoluteFontWeight::Normal) => 400.0,
        FontWeight::Absolute(AbsoluteFontWeight::Bold) => 700.0,
        FontWeight::Absolute(AbsoluteFontWeight::Weight(value)) => f64::from(value),
        _ => return Err(unsupported("relative font weight")),
    };
    if !weight.is_finite() || !(1.0..=1000.0).contains(&weight) {
        return Err(unsupported("font weight"));
    }
    let italic = match request.style {
        FontStyle::Normal => false,
        FontStyle::Italic => true,
        FontStyle::Oblique(_) => return Err(unsupported("font oblique synthesis")),
    };
    let width: lightningcss::values::percentage::Percentage = (&request.stretch).into();
    if !width.0.total_cmp(&1.0).is_eq() {
        return Err(unsupported("font stretch synthesis"));
    }
    let mut selected = None;
    for item in &request.family {
        if let Some(index) = family(item)? {
            selected = Some(index);
            break;
        }
    }
    let offset = match (weight > 500.0, italic) {
        (false, false) => 0,
        (true, false) => 1,
        (false, true) => 2,
        (true, true) => 3,
    };
    let index = selected
        .unwrap_or(0)
        .checked_add(offset)
        .ok_or_else(|| unsupported("builtin font index"))?;
    let cache = FONTS
        .get(index)
        .ok_or_else(|| unsupported("builtin font cache index"))?;
    let bytes = SOURCES
        .get(index)
        .ok_or_else(|| unsupported("builtin font source index"))?;
    cache
        .get_or_init(|| Font::new(bytes.to_vec(), 0).ok_or("invalid pinned public font"))
        .as_ref()
        .cloned()
        .map_err(|message| unsupported(message))
}
