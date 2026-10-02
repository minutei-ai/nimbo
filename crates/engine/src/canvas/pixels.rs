use lightningcss::{traits::Parse, values::color::CssColor};
use num_traits::ToPrimitive;
use serde::Serialize;

use super::error;
use crate::Result;

pub(super) type Pixel = [u8; 4];

pub(super) fn byte(value: f64) -> Result<u8> {
    value
        .round()
        .clamp(0.0, 255.0)
        .to_u8()
        .ok_or_else(|| error("pixel conversion"))
}

pub(super) fn color(source: &str) -> Result<Option<Pixel>> {
    if source.len() > 4096 {
        return Err(error("color bytes limit"));
    }
    if !crate::font_faces::guarded(source) {
        return Ok(None);
    }
    let Ok(color) = CssColor::parse_string(source) else {
        return Ok(None);
    };
    match color {
        CssColor::RGBA(value) => Ok(Some([value.red, value.green, value.blue, value.alpha])),
        _ => Err(error("unsupported color space or context color")),
    }
}

pub(super) fn serialize([red, green, blue, alpha]: Pixel) -> String {
    if alpha == 255 {
        return format!("#{red:02x}{green:02x}{blue:02x}");
    }
    let alpha = f64::from(alpha) / 255.0;
    let short = (alpha * 100.0).round() / 100.0;
    let value = if (short * 255.0)
        .round()
        .total_cmp(&(alpha * 255.0).round())
        .is_eq()
    {
        short
    } else {
        (alpha * 1000.0).round() / 1000.0
    };
    format!("rgba({red}, {green}, {blue}, {value})")
}

pub(super) fn straight(pixel: Pixel) -> Result<Pixel> {
    let [red, green, blue, alpha] = pixel;
    if alpha == 0 {
        return Ok([0; 4]);
    }
    let scale = 255.0 / f64::from(alpha);
    Ok([
        byte(f64::from(red) * scale)?,
        byte(f64::from(green) * scale)?,
        byte(f64::from(blue) * scale)?,
        alpha,
    ])
}

pub(super) fn composite(pixel: Pixel, color: Pixel, amount: f64) -> Result<Pixel> {
    let [red, green, blue, alpha] = color;
    let [old_red, old_green, old_blue, old_alpha] = pixel;
    let alpha = f64::from(alpha) / 255.0 * amount;
    let remaining = 1.0 - alpha;
    Ok([
        byte(f64::from(red) * alpha + f64::from(old_red) * remaining)?,
        byte(f64::from(green) * alpha + f64::from(old_green) * remaining)?,
        byte(f64::from(blue) * alpha + f64::from(old_blue) * remaining)?,
        byte(255.0 * alpha + f64::from(old_alpha) * remaining)?,
    ])
}

#[derive(Clone, Copy, Serialize)]
pub(super) struct State {
    pub color: Pixel,
    pub alpha: f64,
}
impl Default for State {
    fn default() -> Self {
        Self {
            color: [0, 0, 0, 255],
            alpha: 1.0,
        }
    }
}
