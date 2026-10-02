//! Native sRGB compositing of premultiplied RGBA8 pixels.
use serde::{Deserialize, Serialize};

use super::pixels::{self, Pixel};
use crate::Result;

mod blending;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Mode {
    Clear,
    SourceOver,
    SourceIn,
    SourceOut,
    SourceAtop,
    DestinationOver,
    DestinationIn,
    DestinationOut,
    DestinationAtop,
    Lighter,
    Copy,
    Xor,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}
impl Mode {
    pub(super) fn parse(value: &str) -> Option<Self> {
        serde_json::from_value(serde_json::json!(value)).ok()
    }
    pub(super) fn unbounded(self) -> bool {
        matches!(
            self,
            Self::SourceIn
                | Self::SourceOut
                | Self::DestinationIn
                | Self::DestinationAtop
                | Self::Copy
        )
    }
    fn factors(self, source: f64, backdrop: f64) -> (f64, f64) {
        match self {
            Self::Clear => (0.0, 0.0),
            Self::SourceIn => (backdrop, 0.0),
            Self::SourceOut => (1.0 - backdrop, 0.0),
            Self::SourceAtop => (backdrop, 1.0 - source),
            Self::DestinationOver => (1.0 - backdrop, 1.0),
            Self::DestinationIn => (0.0, source),
            Self::DestinationOut => (0.0, 1.0 - source),
            Self::DestinationAtop => (1.0 - backdrop, source),
            Self::Lighter => (1.0, 1.0),
            Self::Copy => (1.0, 0.0),
            Self::Xor => (1.0 - backdrop, 1.0 - source),
            _ => (1.0, 1.0 - source),
        }
    }
}

pub(super) fn composite(
    pixel: Pixel,
    color: Pixel,
    amount: f64,
    mode: Mode,
    opaque: bool,
) -> Result<Pixel> {
    let [red, green, blue, alpha] = color;
    let [old_red, old_green, old_blue, old_alpha] = pixel;
    let source = [red, green, blue].map(|value| f64::from(value) / 255.0);
    let backdrop_alpha = f64::from(old_alpha) / 255.0;
    let source_alpha = f64::from(pixels::byte(f64::from(alpha) * amount)?) / 255.0;
    let stored = [old_red, old_green, old_blue].map(|value| f64::from(value) / 255.0);
    let backdrop = stored.map(|value| {
        if backdrop_alpha > 0.0 {
            value / backdrop_alpha
        } else {
            0.0
        }
    });
    let blend = blending::blend(backdrop, source, mode);
    let (source_factor, backdrop_factor) = mode.factors(source_alpha, backdrop_alpha);
    let combine = |source: f64, stored: f64, blend: f64| -> Result<u8> {
        pixels::byte(
            255.0
                * (source_alpha
                    * source_factor
                    * ((1.0 - backdrop_alpha) * source + backdrop_alpha * blend)
                    + backdrop_factor * stored),
        )
    };
    let [source_red, source_green, source_blue] = source;
    let [stored_red, stored_green, stored_blue] = stored;
    let [blend_red, blend_green, blend_blue] = blend;
    Ok([
        combine(source_red, stored_red, blend_red)?,
        combine(source_green, stored_green, blend_green)?,
        combine(source_blue, stored_blue, blend_blue)?,
        if opaque {
            255
        } else {
            pixels::byte(255.0 * (source_alpha * source_factor + backdrop_alpha * backdrop_factor))?
        },
    ])
}
