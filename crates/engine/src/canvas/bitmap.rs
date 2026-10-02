use serde_json::{Value, json};

use super::{
    compositing::{self, Mode},
    error,
    pixels::{self, Pixel, State},
};
use crate::Result;

pub(super) const PIXELS: usize = 1_048_576;

pub(super) fn count(width: u32, height: u32) -> Result<usize> {
    if width > 4096 || height > 4096 {
        return Err(error("dimensions limit"));
    }
    let count = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or_else(|| error("dimensions limit"))?;
    if count > PIXELS {
        return Err(error("pixels limit"));
    }
    Ok(count)
}

pub(super) struct Bitmap {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<Pixel>,
    pub opaque: bool,
    state: State,
    stack: Vec<State>,
}

impl Bitmap {
    pub(super) fn new(width: u32, height: u32) -> Result<Self> {
        Ok(Self {
            width,
            height,
            pixels: vec![[0; 4]; count(width, height)?],
            opaque: false,
            state: State::default(),
            stack: Vec::new(),
        })
    }
    pub(super) fn reset(&mut self) {
        self.pixels
            .fill(if self.opaque { [0, 0, 0, 255] } else { [0; 4] });
        self.state = State::default();
        self.stack.clear();
    }
    pub(super) fn settings(
        &mut self,
        operation: &str,
        color: &str,
        alpha: Option<f64>,
        mode: &str,
    ) -> Result<Value> {
        match operation {
            "size" => return Ok(json!([self.width, self.height])),
            "state" => {}
            "fillStyle" => {
                if let Some(color) = pixels::color(color)? {
                    self.state.color = color;
                }
            }
            "alpha" => {
                if let Some(alpha) = alpha.filter(|value| (0.0..=1.0).contains(value)) {
                    self.state.alpha = alpha;
                }
            }
            "composite" => {
                if let Some(mode) = Mode::parse(mode) {
                    self.state.mode = mode;
                }
            }
            "save" => {
                if self.stack.len() >= 64 {
                    return Err(error("state stack limit"));
                }
                self.stack.push(self.state);
            }
            "restore" => {
                if let Some(state) = self.stack.pop() {
                    self.state = state;
                }
            }
            "reset" => self.reset(),
            _ => return Err(error("unknown operation")),
        }
        Ok(
            json!({"fillStyle":pixels::serialize(self.state.color),"globalAlpha":self.state.alpha,"globalCompositeOperation":self.state.mode}),
        )
    }
    pub(super) fn unbounded(&self) -> bool {
        self.state.mode.unbounded()
    }
    fn pixel(&self, x: i64, y: i64) -> Option<Pixel> {
        if x < 0 || y < 0 || x >= i64::from(self.width) || y >= i64::from(self.height) {
            return None;
        }
        let index = usize::try_from(y)
            .ok()?
            .checked_mul(usize::try_from(self.width).ok()?)?
            .checked_add(usize::try_from(x).ok()?)?;
        self.pixels.get(index).copied()
    }
    pub(super) fn read(&self, [x, y, width, height]: [i32; 4]) -> Result<Vec<u8>> {
        let count = count(width.unsigned_abs(), height.unsigned_abs())?;
        let bytes = count.checked_mul(4).ok_or_else(|| error("pixels limit"))?;
        let mut output = Vec::with_capacity(bytes);
        let left = i64::from(x).min(i64::from(x).saturating_add(i64::from(width)));
        let top = i64::from(y).min(i64::from(y).saturating_add(i64::from(height)));
        for row in 0..height.unsigned_abs() {
            for column in 0..width.unsigned_abs() {
                output.extend(pixels::straight(
                    self.pixel(
                        left.saturating_add(i64::from(column)),
                        top.saturating_add(i64::from(row)),
                    )
                    .unwrap_or([0; 4]),
                )?);
            }
        }
        Ok(output)
    }
    pub(super) fn clipped(&self, [x, y, width, height]: [f64; 4]) -> Result<([f64; 4], [u32; 4])> {
        let edges = [
            x.min(x + width).max(0.0),
            y.min(y + height).max(0.0),
            x.max(x + width).min(f64::from(self.width)),
            y.max(y + height).min(f64::from(self.height)),
        ];
        let integer = |value: f64, ceil: bool, bound: u32| -> Result<u32> {
            let value = if ceil { value.ceil() } else { value.floor() };
            value
                .clamp(0.0, f64::from(bound))
                .to_string()
                .parse()
                .map_err(|_error| error("rectangle conversion"))
        };
        let [left, top, right, bottom] = edges;
        Ok((
            edges,
            [
                integer(left, false, self.width)?,
                integer(top, false, self.height)?,
                integer(right, true, self.width)?,
                integer(bottom, true, self.height)?,
            ],
        ))
    }
    pub(super) fn paint(&mut self, edges: [f64; 4], bounds: [u32; 4], clear: bool) -> Result<()> {
        let clear = clear || self.state.mode == Mode::Clear;
        let [left, top, right, bottom] = edges;
        let [start_x, start_y, end_x, end_y] = bounds;
        for y in start_y..end_y {
            for x in start_x..end_x {
                let area = (right.min(f64::from(x) + 1.0) - left.max(f64::from(x))).max(0.0)
                    * (bottom.min(f64::from(y) + 1.0) - top.max(f64::from(y))).max(0.0);
                let index = usize::try_from(y)
                    .ok()
                    .and_then(|y| {
                        usize::try_from(self.width)
                            .ok()
                            .and_then(|width| y.checked_mul(width))
                    })
                    .and_then(|index| usize::try_from(x).ok().and_then(|x| index.checked_add(x)))
                    .ok_or_else(|| error("pixel index"))?;
                let pixel = self
                    .pixels
                    .get_mut(index)
                    .ok_or_else(|| error("pixel index"))?;
                if area <= 0.0 {
                    if !clear && self.state.mode.unbounded() {
                        *pixel = if self.opaque { [0, 0, 0, 255] } else { [0; 4] };
                    }
                    continue;
                }
                if area >= 1.0
                    && (clear
                        || (self.state.mode == Mode::SourceOver
                            && self.state.alpha >= 1.0
                            && self.state.color.get(3) == Some(&255)))
                {
                    *pixel = if clear {
                        if self.opaque { [0, 0, 0, 255] } else { [0; 4] }
                    } else {
                        self.state.color
                    };
                    continue;
                }
                *pixel = if clear {
                    let [red, green, blue, alpha] = *pixel;
                    [
                        pixels::byte(f64::from(red) * (1.0 - area))?,
                        pixels::byte(f64::from(green) * (1.0 - area))?,
                        pixels::byte(f64::from(blue) * (1.0 - area))?,
                        if self.opaque {
                            255
                        } else {
                            pixels::byte(f64::from(alpha) * (1.0 - area))?
                        },
                    ]
                } else {
                    compositing::composite(
                        *pixel,
                        self.state.color,
                        area * self.state.alpha,
                        self.state.mode,
                        self.opaque,
                    )?
                };
            }
        }
        Ok(())
    }
}
