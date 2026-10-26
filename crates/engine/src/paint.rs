//! Viewport paint for laid-out boxes: backgrounds, glyphs, replaced images, borders and outset shadows.
use std::io::Cursor;

use image::ImageEncoder;
use lightningcss::properties::{Property, PropertyId};
use lightningcss::stylesheet::ParserOptions;
use lightningcss::traits::Parse;
use lightningcss::values::color::CssColor;

use crate::{Error, Result};

#[path = "paint_glyph.rs"]
mod glyph;
#[path = "paint_pdf.rs"]
mod pdf_doc;

pub(crate) fn pdf(width: u32, viewport_height: u32, layers: &[Layer]) -> Result<Vec<u8>> {
    pdf_doc::pdf(width, viewport_height, layers)
}

/// Viewport bitmap encoded as a `PNG`.
///
/// Pixels are laid-out boxes over a white canvas, in stacking order. An opaque
/// root background covers the viewport. A transparent root transfers the body
/// background to that canvas and does not paint it again on the body box.
/// Glyphs, replaced images, solid borders and zero-blur outset shadows are drawn.
/// `omitted` names paint this bitmap does not contain.
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

const OMISSIONS: &[&str] = &[];

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

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Edges {
    pub(crate) top: f64,
    pub(crate) right: f64,
    pub(crate) bottom: f64,
    pub(crate) left: f64,
    pub(crate) pad_top: f64,
    pub(crate) pad_right: f64,
    pub(crate) pad_bottom: f64,
    pub(crate) pad_left: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShadowPaint {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) spread: f64,
    pub(crate) color: Color,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ImagePaint {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) rgba: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TextPaint {
    pub(crate) text: String,
    pub(crate) size: f64,
    pub(crate) color: Color,
    /// CSS `font` shorthand naming a builtin face, for example `16px sans-serif`.
    pub(crate) font: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Layer {
    color: Color,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    role: Role,
    z: i32,
    order: u32,
    hidden: bool,
    edges: Edges,
    border_color: Color,
    shadow: Option<ShadowPaint>,
    image: Option<ImagePaint>,
    text: Option<TextPaint>,
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
            z: 0,
            order: 0,
            hidden: false,
            edges: Edges {
                top: 0.0,
                right: 0.0,
                bottom: 0.0,
                left: 0.0,
                pad_top: 0.0,
                pad_right: 0.0,
                pad_bottom: 0.0,
                pad_left: 0.0,
            },
            border_color: Color {
                red: 0,
                green: 0,
                blue: 0,
                alpha: 0,
            },
            shadow: None,
            image: None,
            text: None,
        }
    }

    pub(crate) fn with_order(mut self, order: u32) -> Self {
        self.order = order;
        self
    }

    pub(crate) fn with_stack(mut self, z: i32, hidden: bool) -> Self {
        self.z = z;
        self.hidden = hidden;
        self
    }

    pub(crate) fn with_border(mut self, edges: Edges, color: Color) -> Self {
        self.edges = edges;
        self.border_color = color;
        self
    }

    pub(crate) fn with_shadow(mut self, shadow: Option<ShadowPaint>) -> Self {
        self.shadow = shadow;
        self
    }

    pub(crate) fn with_image(mut self, image: Option<ImagePaint>) -> Self {
        self.image = image;
        self
    }

    pub(crate) fn with_text(mut self, text: Option<TextPaint>) -> Self {
        self.text = text;
        self
    }
}

pub(crate) fn color_from_css(value: &str, current: Color) -> Result<Color> {
    if value.is_empty() || value.eq_ignore_ascii_case("currentcolor") {
        return Ok(current);
    }
    let parsed =
        CssColor::parse_string(value).map_err(|_error| Error::Dom("paint color".into()))?;
    css_channels(&parsed, current)
}

pub(crate) fn shadow_from_css(value: &str, current: Color) -> Result<Option<ShadowPaint>> {
    if value.is_empty() || value.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    let parsed = Property::parse_string(
        PropertyId::from("box-shadow"),
        value,
        ParserOptions::default(),
    )
    .map_err(|_error| Error::Dom("paint shadow".into()))?;
    let Property::BoxShadow(shadows, _) = parsed else {
        return Ok(None);
    };
    for shadow in &shadows {
        if shadow.inset {
            continue;
        }
        let blur = shadow.blur.to_px().unwrap_or(0.0);
        if blur > 0.0 {
            continue;
        }
        let (Some(x), Some(y)) = (shadow.x_offset.to_px(), shadow.y_offset.to_px()) else {
            continue;
        };
        let spread = shadow.spread.to_px().unwrap_or(0.0);
        if x.total_cmp(&0.0).is_eq() && y.total_cmp(&0.0).is_eq() && spread.total_cmp(&0.0).is_eq()
        {
            continue;
        }
        return Ok(Some(ShadowPaint {
            x: f64::from(x),
            y: f64::from(y),
            spread: f64::from(spread),
            color: css_channels(&shadow.color, current)?,
        }));
    }
    Ok(None)
}

fn css_channels(color: &CssColor, current: Color) -> Result<Color> {
    match color {
        CssColor::CurrentColor => Ok(current),
        CssColor::RGBA(value) => Ok(Color {
            red: value.red,
            green: value.green,
            blue: value.blue,
            alpha: value.alpha,
        }),
        _ => Err(Error::Dom("paint color space".into())),
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
    let buffer = raster(width, height, 0.0, layers)?;
    Ok(Screenshot {
        png: encode_png(width, height, &buffer)?,
        width,
        height,
        omitted: OMISSIONS,
    })
}

fn raster(width: u32, height: u32, origin_y: f64, layers: &[Layer]) -> Result<Vec<[u8; 4]>> {
    let count = pixel_count(width, height)?;
    let canvas = flatten(canvas_color(layers))?;
    let mut buffer = vec![canvas; count];
    let root_transparent = root_is_transparent(layers);
    let mut order = (0..layers.len()).collect::<Vec<_>>();
    order.sort_by(|left, right| {
        let left = layers.get(*left);
        let right = layers.get(*right);
        match (left, right) {
            (Some(left), Some(right)) => left.z.cmp(&right.z).then(left.order.cmp(&right.order)),
            _ => std::cmp::Ordering::Equal,
        }
    });
    for index in order {
        let Some(layer) = layers.get(index) else {
            continue;
        };
        if layer.hidden {
            continue;
        }
        paint_layer(
            &mut buffer,
            width,
            height,
            layer,
            root_transparent,
            origin_y,
        )?;
    }
    Ok(buffer)
}

fn translate_y(y: f64, origin_y: f64) -> Result<f64> {
    let shifted = y - origin_y;
    if !shifted.is_finite() {
        return Err(Error::Dom("non-finite paint box".into()));
    }
    Ok(shifted)
}

fn paint_layer(
    buffer: &mut [[u8; 4]],
    width: u32,
    height: u32,
    layer: &Layer,
    root_transparent: bool,
    origin_y: f64,
) -> Result<()> {
    let y = translate_y(layer.y, origin_y)?;
    if let Some(shadow) = layer.shadow {
        fill_rect(
            buffer,
            width,
            height,
            Rect {
                x: layer.x + shadow.x - shadow.spread,
                y: y + shadow.y - shadow.spread,
                width: layer.width + shadow.spread + shadow.spread,
                height: layer.height + shadow.spread + shadow.spread,
            },
            shadow.color,
        )?;
    }
    if paints_box(layer, root_transparent) {
        fill_rect(
            buffer,
            width,
            height,
            Rect {
                x: layer.x,
                y,
                width: layer.width,
                height: layer.height,
            },
            layer.color,
        )?;
    }
    paint_border(buffer, width, height, layer, y)?;
    let content = content_box(layer, y);
    if let Some(image) = &layer.image {
        blit_image(buffer, width, height, image, content)?;
    }
    if let Some(text) = &layer.text
        && let Ok(font) = crate::builtin_fonts::source(&text.font)
    {
        glyph::paint(
            buffer,
            (width, height),
            &text.text,
            text.size,
            text.color,
            font,
            content,
        )?;
    }
    Ok(())
}

fn content_box(layer: &Layer, y: f64) -> Rect {
    Rect {
        x: layer.x + layer.edges.left + layer.edges.pad_left,
        y: y + layer.edges.top + layer.edges.pad_top,
        width: layer.width
            - layer.edges.left
            - layer.edges.right
            - layer.edges.pad_left
            - layer.edges.pad_right,
        height: layer.height
            - layer.edges.top
            - layer.edges.bottom
            - layer.edges.pad_top
            - layer.edges.pad_bottom,
    }
}

fn paint_border(
    buffer: &mut [[u8; 4]],
    width: u32,
    height: u32,
    layer: &Layer,
    y: f64,
) -> Result<()> {
    let color = layer.border_color;
    if color.alpha == 0 {
        return Ok(());
    }
    let edges = [
        (layer.x, y, layer.width, layer.edges.top),
        (
            layer.x,
            y + layer.height - layer.edges.bottom,
            layer.width,
            layer.edges.bottom,
        ),
        (layer.x, y, layer.edges.left, layer.height),
        (
            layer.x + layer.width - layer.edges.right,
            y,
            layer.edges.right,
            layer.height,
        ),
    ];
    for (x, y, box_width, box_height) in edges {
        if box_width > 0.0 && box_height > 0.0 {
            fill_rect(
                buffer,
                width,
                height,
                Rect {
                    x,
                    y,
                    width: box_width,
                    height: box_height,
                },
                color,
            )?;
        }
    }
    Ok(())
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

fn fill_rect(
    buffer: &mut [[u8; 4]],
    width: u32,
    height: u32,
    area: Rect,
    color: Color,
) -> Result<()> {
    if color.alpha == 0 || area.width <= 0.0 || area.height <= 0.0 {
        return Ok(());
    }
    let left = axis(area.x, width, false)?;
    let top = axis(area.y, height, false)?;
    let right = axis(area.x + area.width, width, true)?;
    let bottom = axis(area.y + area.height, height, true)?;
    if left >= right || top >= bottom {
        return Ok(());
    }
    for y in top..bottom {
        for x in left..right {
            let index = pixel_index(x, y, width)?;
            let slot = buffer
                .get_mut(index)
                .ok_or_else(|| Error::Limit("screenshot pixels"))?;
            *slot = blend(*slot, color)?;
        }
    }
    Ok(())
}

fn blit_image(
    buffer: &mut [[u8; 4]],
    width: u32,
    height: u32,
    image: &ImagePaint,
    dest: Rect,
) -> Result<()> {
    if image.width == 0 || image.height == 0 || dest.width <= 0.0 || dest.height <= 0.0 {
        return Ok(());
    }
    let expected = usize::try_from(image.width)
        .ok()
        .and_then(|pixels| {
            usize::try_from(image.height)
                .ok()
                .and_then(|rows| pixels.checked_mul(rows))
        })
        .and_then(|pixels| pixels.checked_mul(4));
    if expected.is_none_or(|expected| expected != image.rgba.len()) {
        return Err(Error::Unsupported("replaced image pixels".into()));
    }
    let left = axis(dest.x, width, false)?;
    let top = axis(dest.y, height, false)?;
    let right = axis(dest.x + dest.width, width, true)?;
    let bottom = axis(dest.y + dest.height, height, true)?;
    for y in top..bottom {
        for x in left..right {
            let u = (f64::from(x) + 0.5 - dest.x) / dest.width;
            let v = (f64::from(y) + 0.5 - dest.y) / dest.height;
            let source_x = source_pixel(u, image.width)?;
            let source_y = source_pixel(v, image.height)?;
            let sample = usize::try_from(source_y)
                .ok()
                .and_then(|row| {
                    usize::try_from(image.width)
                        .ok()
                        .and_then(|row_width| row.checked_mul(row_width))
                })
                .and_then(|row| {
                    usize::try_from(source_x)
                        .ok()
                        .and_then(|column| row.checked_add(column))
                })
                .and_then(|pixel| pixel.checked_mul(4));
            let Some(sample) = sample else {
                return Err(Error::Limit("screenshot pixels"));
            };
            let red = image
                .rgba
                .get(sample)
                .copied()
                .ok_or_else(|| Error::Unsupported("replaced image pixels".into()))?;
            let green = image
                .rgba
                .get(sample.saturating_add(1))
                .copied()
                .ok_or_else(|| Error::Unsupported("replaced image pixels".into()))?;
            let blue = image
                .rgba
                .get(sample.saturating_add(2))
                .copied()
                .ok_or_else(|| Error::Unsupported("replaced image pixels".into()))?;
            let alpha = image
                .rgba
                .get(sample.saturating_add(3))
                .copied()
                .ok_or_else(|| Error::Unsupported("replaced image pixels".into()))?;
            let index = pixel_index(x, y, width)?;
            let slot = buffer
                .get_mut(index)
                .ok_or_else(|| Error::Limit("screenshot pixels"))?;
            *slot = blend(
                *slot,
                Color {
                    red,
                    green,
                    blue,
                    alpha,
                },
            )?;
        }
    }
    Ok(())
}

fn source_pixel(unit: f64, limit: u32) -> Result<u32> {
    if !unit.is_finite() || limit == 0 {
        return Err(Error::Dom("replaced image sample".into()));
    }
    let last = f64::from(limit.saturating_sub(1));
    let text = format!("{:.0}", (unit * f64::from(limit)).floor().clamp(0.0, last));
    text.parse()
        .map_err(|_error| Error::Dom("replaced image sample".into()))
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
        assert!(shot.omitted.is_empty());
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

    #[test]
    fn pdf_repeats_the_viewport_and_adds_the_fold() -> Result<()> {
        let layers = [
            Layer::new(
                Role::Root,
                parse_color("rgb(0, 255, 0)")?,
                0.0,
                0.0,
                4.0,
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
            Layer::new(
                Role::Box,
                parse_color("rgb(0, 0, 255)")?,
                0.0,
                3.0,
                2.0,
                1.0,
            ),
        ];
        let shot = encode(4, 2, &layers)?;
        let document = super::pdf(4, 2, &layers)?;
        let images = pdf_images(&document)?;
        assert_eq!(images.len(), 2);
        let first = images
            .first()
            .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
        assert_eq!(first.len(), 8);
        for y in 0..2 {
            for x in 0..4 {
                let png = pixel(&shot.png, x, y)?;
                let index = usize::try_from(y)
                    .ok()
                    .and_then(|row| row.checked_mul(4))
                    .and_then(|row| {
                        usize::try_from(x)
                            .ok()
                            .and_then(|column| row.checked_add(column))
                    })
                    .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
                let sample = first
                    .get(index)
                    .copied()
                    .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
                assert_eq!(sample, [png[0], png[1], png[2]]);
            }
        }
        let second = images
            .get(1)
            .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
        assert_eq!(second.first().copied(), Some([0, 255, 0]));
        assert_eq!(second.get(4).copied(), Some([0, 0, 255]));
        Ok(())
    }

    #[test]
    fn pdf_encodes_a_second_page_at_the_default_viewport() -> Result<()> {
        let layers = [
            Layer::new(
                Role::Root,
                parse_color("rgb(0, 255, 0)")?,
                0.0,
                0.0,
                1024.0,
                768.0,
            ),
            Layer::new(
                Role::Box,
                parse_color("rgb(255, 0, 0)")?,
                0.0,
                0.0,
                8.0,
                8.0,
            ),
            Layer::new(
                Role::Box,
                parse_color("rgb(255, 255, 0)")?,
                20.0,
                766.0,
                4.0,
                4.0,
            ),
            Layer::new(
                Role::Box,
                parse_color("rgb(0, 0, 255)")?,
                0.0,
                900.0,
                8.0,
                8.0,
            ),
        ];
        let shot = encode(1024, 768, &layers)?;
        let document = super::pdf(1024, 768, &layers)?;
        assert!(document.starts_with(b"%PDF-1.4"));
        let images = pdf_images(&document)?;
        assert_eq!(images.len(), 2);
        let count = 1024_usize
            .checked_mul(768)
            .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
        let first = images
            .first()
            .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
        let second = images
            .get(1)
            .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
        assert_eq!(first.len(), count);
        assert_eq!(second.len(), count);
        for (x, y) in [(1_u32, 1_u32), (40, 30), (21, 766), (1, 132)] {
            let png = pixel(&shot.png, x, y)?;
            assert_eq!(pdf_rgb(first, 1024, x, y)?, [png[0], png[1], png[2]]);
        }
        assert_eq!(pdf_rgb(first, 1024, 1, 1)?, [255, 0, 0]);
        assert_eq!(pdf_rgb(first, 1024, 21, 766)?, [255, 255, 0]);
        assert_eq!(pdf_rgb(second, 1024, 21, 0)?, [255, 255, 0]);
        assert_eq!(pdf_rgb(second, 1024, 21, 2)?, [0, 255, 0]);
        assert_eq!(pdf_rgb(second, 1024, 1, 132)?, [0, 0, 255]);
        assert_eq!(pdf_rgb(first, 1024, 1, 132)?, [0, 255, 0]);
        Ok(())
    }

    #[test]
    fn pdf_rejects_a_viewport_past_the_pixel_budget() -> Result<()> {
        let layers = [Layer::new(
            Role::Box,
            parse_color("rgb(255, 0, 0)")?,
            0.0,
            0.0,
            1.0,
            1.0,
        )];
        match super::pdf(2048, 768, &layers) {
            Err(crate::Error::Limit("screenshot pixels")) => Ok(()),
            Err(error) => Err(error),
            Ok(_document) => Err(crate::Error::Limit("screenshot pixels")),
        }
    }

    fn pdf_rgb(pixels: &[[u8; 3]], width: u32, x: u32, y: u32) -> Result<[u8; 3]> {
        let index = usize::try_from(y)
            .ok()
            .and_then(|row| {
                usize::try_from(width)
                    .ok()
                    .and_then(|row_width| row.checked_mul(row_width))
            })
            .and_then(|row| {
                usize::try_from(x)
                    .ok()
                    .and_then(|column| row.checked_add(column))
            })
            .ok_or_else(|| crate::Error::Limit("pdf pages"))?;
        pixels
            .get(index)
            .copied()
            .ok_or_else(|| crate::Error::Limit("pdf pages"))
    }

    fn pdf_images(document: &[u8]) -> Result<Vec<Vec<[u8; 3]>>> {
        let mut images = Vec::new();
        let mut rest = document;
        let marker = b"/Subtype /Image";
        while let Some(found) = rest
            .windows(marker.len())
            .position(|window| window == marker)
        {
            let after = rest.get(found..).unwrap_or_default();
            let stream_at = after
                .windows(7)
                .position(|window| window == b"stream\n")
                .ok_or_else(|| crate::Error::Dom("pdf image".into()))?;
            let data = after
                .get(stream_at.saturating_add(7)..)
                .ok_or_else(|| crate::Error::Dom("pdf image".into()))?;
            let end = data
                .windows(10)
                .position(|window| window == b"\nendstream")
                .ok_or_else(|| crate::Error::Dom("pdf image".into()))?;
            let encoded = data
                .get(..end)
                .ok_or_else(|| crate::Error::Dom("pdf image".into()))?;
            images.push(decode_hex(encoded)?);
            rest = data.get(end..).unwrap_or_default();
        }
        Ok(images)
    }

    fn decode_hex(encoded: &[u8]) -> Result<Vec<[u8; 3]>> {
        let mut nibbles = Vec::new();
        for byte in encoded {
            match byte {
                b'0'..=b'9' => nibbles.push(
                    byte.checked_sub(b'0')
                        .ok_or_else(|| crate::Error::Dom("pdf hex".into()))?,
                ),
                b'A'..=b'F' => nibbles.push(
                    byte.checked_sub(b'A')
                        .and_then(|value| value.checked_add(10))
                        .ok_or_else(|| crate::Error::Dom("pdf hex".into()))?,
                ),
                b'>' => break,
                b' ' | b'\n' | b'\r' | b'\t' => {}
                _ => return Err(crate::Error::Dom("pdf hex".into())),
            }
        }
        if nibbles.len().checked_rem(2) != Some(0) {
            return Err(crate::Error::Dom("pdf hex".into()));
        }
        let mut bytes = Vec::new();
        let mut index = 0;
        while index < nibbles.len() {
            let hi = nibbles.get(index).copied().unwrap_or(0);
            let lo = nibbles.get(index.saturating_add(1)).copied().unwrap_or(0);
            bytes.push(
                hi.checked_mul(16)
                    .and_then(|value| value.checked_add(lo))
                    .ok_or_else(|| crate::Error::Dom("pdf hex".into()))?,
            );
            index = index.saturating_add(2);
        }
        if bytes.len().checked_rem(3) != Some(0) {
            return Err(crate::Error::Dom("pdf hex".into()));
        }
        let mut pixels = Vec::new();
        let mut index = 0;
        while index < bytes.len() {
            pixels.push([
                bytes.get(index).copied().unwrap_or(0),
                bytes.get(index.saturating_add(1)).copied().unwrap_or(0),
                bytes.get(index.saturating_add(2)).copied().unwrap_or(0),
            ]);
            index = index.saturating_add(3);
        }
        Ok(pixels)
    }
}
