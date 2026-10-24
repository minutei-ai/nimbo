//! Viewport background paint. Glyphs, replaced images, borders and shadows stay out of the bitmap.
use std::io::Cursor;

use image::ImageEncoder;

use crate::{Error, Result};

/// Viewport bitmap encoded as a `PNG`.
///
/// Pixels are background colors of laid-out boxes, in tree order, over a white
/// canvas. An opaque root background covers the viewport. A transparent root
/// transfers the body background to that canvas and does not paint it again on
/// the body box. `omitted` names the paint this bitmap does not contain.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct Screenshot {
    /// Encoded `PNG` bytes.
    pub png: Vec<u8>,
    /// Viewport width in `CSS` pixels.
    pub width: u32,
    /// Viewport height in `CSS` pixels.
    pub height: u32,
    /// Paint features absent from `png`.
    pub omitted: &'static [&'static str],
}

const OMISSIONS: &[&str] = &[
    "glyphs",
    "replaced images",
    "borders",
    "box shadows",
    "stacking contexts",
    "visibility",
    "shadow trees",
];

const MAX_EDGE: u32 = 4096;
const MAX_PIXELS: usize = 1_048_576;
const WHITE: Color = Color {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 255,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Color {
    red: u8,
    green: u8,
    blue: u8,
    alpha: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    Root,
    Body,
    Box,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Layer {
    color: Color,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    role: Role,
}

impl Layer {
    pub(crate) const fn new(
        role: Role,
        color: Color,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Self {
        Self {
            color,
            x,
            y,
            width,
            height,
            role,
        }
    }
}

pub(crate) fn parse_color(value: &str) -> Result<Color> {
    let (body, has_alpha) = if let Some(body) = prefixed(value, "rgb(") {
        (body, false)
    } else if let Some(body) = prefixed(value, "rgba(") {
        (body, true)
    } else {
        return Err(invalid_color());
    };
    let mut parts = body.split(',');
    let red = channel(parts.next())?;
    let green = channel(parts.next())?;
    let blue = channel(parts.next())?;
    let alpha = if has_alpha {
        byte(alpha_unit(parts.next())? * 255.0)?
    } else {
        255
    };
    if parts.next().is_some() {
        return Err(invalid_color());
    }
    Ok(Color {
        red,
        green,
        blue,
        alpha,
    })
}

pub(crate) fn encode(width: u32, height: u32, layers: &[Layer]) -> Result<Screenshot> {
    let count = pixel_count(width, height)?;
    let canvas = flatten(canvas_color(layers))?;
    let mut buffer = vec![canvas; count];
    let root_transparent = root_is_transparent(layers);
    for layer in layers {
        if paints_box(layer, root_transparent) {
            fill_rect(&mut buffer, width, height, layer)?;
        }
    }
    Ok(Screenshot {
        png: encode_png(width, height, &buffer)?,
        width,
        height,
        omitted: OMISSIONS,
    })
}

fn paints_box(layer: &Layer, root_transparent: bool) -> bool {
    if layer.color.alpha == 0 || layer.width <= 0.0 || layer.height <= 0.0 {
        return false;
    }
    match layer.role {
        Role::Root => false,
        // A transparent root already moved this color onto the canvas.
        Role::Body => !root_transparent,
        Role::Box => true,
    }
}

fn canvas_color(layers: &[Layer]) -> Color {
    let root = role_color(layers, Role::Root);
    if root.alpha > 0 {
        return root;
    }
    let body = role_color(layers, Role::Body);
    if body.alpha > 0 { body } else { WHITE }
}

fn root_is_transparent(layers: &[Layer]) -> bool {
    role_color(layers, Role::Root).alpha == 0
}

fn role_color(layers: &[Layer], role: Role) -> Color {
    layers
        .iter()
        .find(|layer| layer.role == role)
        .map_or(WHITE.with_alpha(0), |layer| layer.color)
}

impl Color {
    const fn with_alpha(self, alpha: u8) -> Self {
        Self { alpha, ..self }
    }
}

fn flatten(color: Color) -> Result<[u8; 4]> {
    blend([255, 255, 255, 255], color)
}

fn fill_rect(buffer: &mut [[u8; 4]], width: u32, height: u32, layer: &Layer) -> Result<()> {
    let left = axis(layer.x, width, false)?;
    let top = axis(layer.y, height, false)?;
    let right = axis(layer.x + layer.width, width, true)?;
    let bottom = axis(layer.y + layer.height, height, true)?;
    if left >= right || top >= bottom {
        return Ok(());
    }
    for y in top..bottom {
        for x in left..right {
            let index = pixel_index(x, y, width)?;
            let slot = buffer
                .get_mut(index)
                .ok_or_else(|| Error::Limit("screenshot pixels"))?;
            *slot = blend(*slot, layer.color)?;
        }
    }
    Ok(())
}

fn pixel_index(x: u32, y: u32, width: u32) -> Result<usize> {
    usize::try_from(y)
        .ok()
        .and_then(|y| {
            usize::try_from(width)
                .ok()
                .and_then(|width| y.checked_mul(width))
        })
        .and_then(|index| usize::try_from(x).ok().and_then(|x| index.checked_add(x)))
        .ok_or_else(|| Error::Limit("screenshot pixels"))
}

fn axis(value: f64, limit: u32, ceil: bool) -> Result<u32> {
    if !value.is_finite() {
        return Err(Error::Dom("non-finite paint box".into()));
    }
    let value = if ceil { value.ceil() } else { value.floor() };
    let text = format!("{:.0}", value.clamp(0.0, f64::from(limit)));
    text.parse()
        .map_err(|_error| Error::Dom("paint box".into()))
}

fn blend(dst: [u8; 4], src: Color) -> Result<[u8; 4]> {
    if src.alpha == 0 {
        return Ok(dst);
    }
    if src.alpha == 255 {
        return Ok([src.red, src.green, src.blue, 255]);
    }
    let [dst_red, dst_green, dst_blue, dst_alpha] = dst;
    let src_a = f64::from(src.alpha) / 255.0;
    let dst_a = f64::from(dst_alpha) / 255.0;
    let inverse = 1.0 - src_a;
    let out_a = src_a + dst_a * inverse;
    if out_a <= 0.0 {
        return Ok([0, 0, 0, 0]);
    }
    let mixed = |src_channel: u8, dst_channel: u8| {
        byte((f64::from(src_channel) * src_a + f64::from(dst_channel) * dst_a * inverse) / out_a)
    };
    Ok([
        mixed(src.red, dst_red)?,
        mixed(src.green, dst_green)?,
        mixed(src.blue, dst_blue)?,
        byte(out_a * 255.0)?,
    ])
}

fn encode_png(width: u32, height: u32, pixels: &[[u8; 4]]) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    for pixel in pixels {
        bytes.extend(pixel);
    }
    let mut output = Cursor::new(Vec::new());
    image::codecs::png::PngEncoder::new(&mut output)
        .write_image(&bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|_error| Error::Unsupported("screenshot encoding".into()))?;
    Ok(output.into_inner())
}

fn pixel_count(width: u32, height: u32) -> Result<usize> {
    if width == 0 || height == 0 || width > MAX_EDGE || height > MAX_EDGE {
        return Err(Error::Limit("screenshot pixels"));
    }
    let count = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or_else(|| Error::Limit("screenshot pixels"))?;
    if count > MAX_PIXELS {
        return Err(Error::Limit("screenshot pixels"));
    }
    Ok(count)
}

fn prefixed<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    value
        .strip_prefix(prefix)
        .and_then(|body| body.strip_suffix(')'))
}

fn channel(value: Option<&str>) -> Result<u8> {
    value
        .ok_or_else(invalid_color)?
        .trim()
        .parse()
        .map_err(|_error| invalid_color())
}

fn alpha_unit(value: Option<&str>) -> Result<f64> {
    let parsed = value
        .ok_or_else(invalid_color)?
        .trim()
        .parse::<f64>()
        .map_err(|_error| invalid_color())?;
    if !(0.0..=1.0).contains(&parsed) {
        return Err(invalid_color());
    }
    Ok(parsed)
}

fn byte(value: f64) -> Result<u8> {
    if !value.is_finite() {
        return Err(invalid_color());
    }
    let text = format!("{:.0}", value.round().clamp(0.0, 255.0));
    text.parse().map_err(|_error| invalid_color())
}

fn invalid_color() -> Error {
    Error::Dom("unparsed background color".into())
}

#[cfg(test)]
mod tests {
    use super::{Layer, Role, encode, parse_color};
    use crate::Result;

    fn pixel(png: &[u8], x: u32, y: u32) -> Result<[u8; 4]> {
        let image = image::load_from_memory(png)
            .map_err(|_error| crate::Error::Unsupported("screenshot decoding".into()))?
            .into_rgba8();
        image
            .get_pixel_checked(x, y)
            .map(|pixel| pixel.0)
            .ok_or_else(|| crate::Error::Dom("pixel outside screenshot".into()))
    }

    #[test]
    fn transparent_root_paints_the_body_color_across_the_viewport() -> Result<()> {
        let layers = [
            Layer::new(
                Role::Root,
                parse_color("rgba(0, 0, 0, 0)")?,
                0.0,
                0.0,
                8.0,
                2.0,
            ),
            Layer::new(
                Role::Body,
                parse_color("rgb(0, 0, 255)")?,
                0.0,
                0.0,
                8.0,
                2.0,
            ),
            Layer::new(
                Role::Box,
                parse_color("rgb(255, 0, 0)")?,
                0.0,
                0.0,
                2.0,
                2.0,
            ),
        ];
        let shot = encode(4, 4, &layers)?;
        assert_eq!(pixel(&shot.png, 0, 0)?, [255, 0, 0, 255]);
        assert_eq!(pixel(&shot.png, 3, 3)?, [0, 0, 255, 255]);
        assert!(shot.omitted.contains(&"glyphs"));
        Ok(())
    }

    #[test]
    fn opaque_root_stays_visible_outside_the_body_box() -> Result<()> {
        let layers = [
            Layer::new(
                Role::Root,
                parse_color("rgb(0, 255, 0)")?,
                0.0,
                0.0,
                8.0,
                2.0,
            ),
            Layer::new(
                Role::Body,
                parse_color("rgb(0, 0, 255)")?,
                0.0,
                0.0,
                8.0,
                2.0,
            ),
            Layer::new(
                Role::Box,
                parse_color("rgb(255, 0, 0)")?,
                0.0,
                0.0,
                2.0,
                2.0,
            ),
        ];
        let shot = encode(4, 4, &layers)?;
        assert_eq!(pixel(&shot.png, 0, 0)?, [255, 0, 0, 255]);
        assert_eq!(pixel(&shot.png, 3, 0)?, [0, 0, 255, 255]);
        assert_eq!(pixel(&shot.png, 3, 3)?, [0, 255, 0, 255]);
        Ok(())
    }

    #[test]
    fn translucent_red_blends_over_the_white_canvas() -> Result<()> {
        let layers = [Layer::new(
            Role::Box,
            parse_color("rgba(255, 0, 0, 0.5)")?,
            0.0,
            0.0,
            1.0,
            1.0,
        )];
        let shot = encode(1, 1, &layers)?;
        assert_eq!(pixel(&shot.png, 0, 0)?, [255, 127, 127, 255]);
        Ok(())
    }
}
