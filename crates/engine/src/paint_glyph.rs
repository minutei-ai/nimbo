//! Rasterizes TrueType outlines from the fonts the engine already measures.
use ttf_parser::{Face, OutlineBuilder};

use super::{Color, Rect, blend, pixel_index};
use crate::{Error, Result};

struct Outline {
    scale: f64,
    origin_x: f64,
    baseline: f64,
    contours: Vec<Vec<(f64, f64)>>,
    current: Vec<(f64, f64)>,
}

impl Outline {
    fn map(&self, x: f32, y: f32) -> (f64, f64) {
        (
            self.origin_x + f64::from(x) * self.scale,
            self.baseline - f64::from(y) * self.scale,
        )
    }

    fn finish(&mut self) {
        if self.current.len() > 1 {
            self.contours.push(std::mem::take(&mut self.current));
        } else {
            self.current.clear();
        }
    }

    fn flatten(&mut self, points: &[(f64, f64)]) {
        for step in 1..=6 {
            let t = f64::from(step) / 6.0;
            let u = 1.0 - t;
            let point = match points {
                [p0, p1, p2] => (
                    u * u * p0.0 + 2.0 * u * t * p1.0 + t * t * p2.0,
                    u * u * p0.1 + 2.0 * u * t * p1.1 + t * t * p2.1,
                ),
                [p0, p1, p2, p3] => (
                    u * u * u * p0.0
                        + 3.0 * u * u * t * p1.0
                        + 3.0 * u * t * t * p2.0
                        + t * t * t * p3.0,
                    u * u * u * p0.1
                        + 3.0 * u * u * t * p1.1
                        + 3.0 * u * t * t * p2.1
                        + t * t * t * p3.1,
                ),
                _ => return,
            };
            self.current.push(point);
        }
    }
}

impl OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish();
        self.current.push(self.map(x, y));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.current.push(self.map(x, y));
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let start = self
            .current
            .last()
            .copied()
            .unwrap_or_else(|| self.map(x, y));
        self.flatten(&[start, self.map(x1, y1), self.map(x, y)]);
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let start = self
            .current
            .last()
            .copied()
            .unwrap_or_else(|| self.map(x, y));
        self.flatten(&[start, self.map(x1, y1), self.map(x2, y2), self.map(x, y)]);
    }

    fn close(&mut self) {
        if let Some(first) = self.current.first().copied() {
            self.current.push(first);
        }
        self.finish();
    }
}

pub(super) fn paint(
    buffer: &mut [[u8; 4]],
    viewport: (u32, u32),
    text: &str,
    size: f64,
    color: Color,
    font: &[u8],
    content: Rect,
) -> Result<()> {
    if text.is_empty()
        || !(size.is_finite() && size > 0.0)
        || content.width <= 0.0
        || content.height <= 0.0
        || color.alpha == 0
    {
        return Ok(());
    }
    let face = Face::parse(font, 0).map_err(|_error| Error::Unsupported("glyph face".into()))?;
    let units = face.units_per_em();
    if units == 0 {
        return Ok(());
    }
    let scale = size / f64::from(units);
    if !scale.is_finite() || scale <= 0.0 {
        return Ok(());
    }
    let baseline = content.y + f64::from(face.ascender()) * scale;
    let mut pen = content.x;
    let limit = content.x + content.width;
    for (index, ch) in text.chars().enumerate() {
        if index >= 1024 || pen >= limit {
            break;
        }
        let Some(glyph) = face.glyph_index(ch) else {
            continue;
        };
        let mut outline = Outline {
            scale,
            origin_x: pen,
            baseline,
            contours: Vec::new(),
            current: Vec::new(),
        };
        if face.outline_glyph(glyph, &mut outline).is_some() {
            outline.finish();
            fill_contours(buffer, viewport, &outline.contours, color, content)?;
        }
        let advance = face.glyph_hor_advance(glyph).unwrap_or(0);
        pen += f64::from(advance) * scale;
    }
    Ok(())
}

fn fill_contours(
    buffer: &mut [[u8; 4]],
    viewport: (u32, u32),
    contours: &[Vec<(f64, f64)>],
    color: Color,
    clip: Rect,
) -> Result<()> {
    let (viewport_width, viewport_height) = viewport;
    let mut edges = Vec::new();
    for contour in contours {
        let mut previous = None;
        for point in contour {
            if let Some(start) = previous {
                edges.push((start, *point));
            }
            previous = Some(*point);
        }
    }
    let top = super::axis(clip.y, viewport_height, false)?;
    let bottom = super::axis(clip.y + clip.height, viewport_height, true)?;
    let left_limit = super::axis(clip.x, viewport_width, false)?;
    let right_limit = super::axis(clip.x + clip.width, viewport_width, true)?;
    for y in top..bottom {
        let scan = f64::from(y) + 0.5;
        let mut hits = Vec::new();
        for ((x0, y0), (x1, y1)) in &edges {
            if !crosses(*y0, *y1, scan) {
                continue;
            }
            let dy = y1 - y0;
            if dy.total_cmp(&0.0).is_eq() {
                continue;
            }
            let t = (scan - y0) / dy;
            hits.push(x0 + t * (x1 - x0));
        }
        hits.sort_by(f64::total_cmp);
        let mut index = 0_usize;
        while index < hits.len() {
            let Some(start) = hits.get(index).copied() else {
                break;
            };
            let Some(end) = hits.get(index.saturating_add(1)).copied() else {
                break;
            };
            index = index.saturating_add(2);
            let from = super::axis(start, viewport_width, false)?.max(left_limit);
            let to = super::axis(end, viewport_width, true)?.min(right_limit);
            if from >= to {
                continue;
            }
            for x in from..to {
                let slot = pixel_index(x, y, viewport_width)?;
                let pixel = buffer
                    .get_mut(slot)
                    .ok_or_else(|| Error::Limit("screenshot pixels"))?;
                *pixel = blend(*pixel, color)?;
            }
        }
    }
    Ok(())
}

fn crosses(start: f64, end: f64, scan: f64) -> bool {
    (start < scan && end >= scan) || (end < scan && start >= scan)
}
