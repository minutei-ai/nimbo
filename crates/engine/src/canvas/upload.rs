//! `ImageData` replacement with bounded byte transfer and source/destination clipping.
use std::{cell::RefCell, rc::Rc};

use rquickjs::{Ctx, Exception, Function, TypedArray};
use serde::Deserialize;

use super::{Bitmaps, bitmap, error, pixels};
use crate::Result;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Upload {
    id: usize,
    width: u32,
    height: u32,
    position: [i32; 2],
    region: [i32; 4],
}

fn index(x: i64, y: i64, width: u32) -> Result<usize> {
    usize::try_from(y)
        .ok()
        .and_then(|y| {
            usize::try_from(width)
                .ok()
                .and_then(|width| y.checked_mul(width))
        })
        .and_then(|offset| usize::try_from(x).ok().and_then(|x| offset.checked_add(x)))
        .ok_or_else(|| error("pixel index"))
}

impl Upload {
    fn bounds(&self, target: &bitmap::Bitmap) -> [i64; 4] {
        let [x, y, width, height] = self.region.map(i64::from);
        let [dx, dy] = self.position.map(i64::from);
        [
            x.min(x.saturating_add(width))
                .max(0)
                .max(dx.saturating_neg()),
            y.min(y.saturating_add(height))
                .max(0)
                .max(dy.saturating_neg()),
            x.max(x.saturating_add(width))
                .min(i64::from(self.width))
                .min(i64::from(target.width).saturating_sub(dx)),
            y.max(y.saturating_add(height))
                .min(i64::from(self.height))
                .min(i64::from(target.height).saturating_sub(dy)),
        ]
    }
    fn write(&self, target: &mut bitmap::Bitmap, bytes: &[u8]) -> Result<()> {
        let [left, top, right, bottom] = self.bounds(target);
        let [dx, dy] = self.position.map(i64::from);
        for y in top..bottom {
            for x in left..right {
                let offset = index(x, y, self.width)?
                    .checked_mul(4)
                    .ok_or_else(|| error("pixel index"))?;
                let end = offset.checked_add(4).ok_or_else(|| error("pixel index"))?;
                let pixel: [u8; 4] = bytes
                    .get(offset..end)
                    .and_then(|pixel| pixel.try_into().ok())
                    .ok_or_else(|| error("pixel input"))?;
                let [red, green, blue, alpha] = pixel;
                let scale = f64::from(alpha) / 255.0;
                let value = [
                    pixels::byte(f64::from(red) * scale)?,
                    pixels::byte(f64::from(green) * scale)?,
                    pixels::byte(f64::from(blue) * scale)?,
                    if target.opaque { 255 } else { alpha },
                ];
                let destination = index(x.saturating_add(dx), y.saturating_add(dy), target.width)?;
                *target
                    .pixels
                    .get_mut(destination)
                    .ok_or_else(|| error("pixel index"))? = value;
            }
        }
        Ok(())
    }
}

pub(super) fn install<'js>(ctx: &Ctx<'js>, bitmaps: Rc<RefCell<Bitmaps>>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "nimboCanvasPut",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, source: String, input: TypedArray<'js, u8>| {
                let run = || -> Result<()> {
                    if source.len() > 8192 {
                        return Err(error("input limit"));
                    }
                    let upload: Upload = serde_json::from_str(&source)?;
                    let count = bitmap::count(upload.width, upload.height)?;
                    let length = count.checked_mul(4).ok_or_else(|| error("pixels limit"))?;
                    if input.len() != length {
                        return Err(error("pixel input"));
                    }
                    let mut bitmaps = bitmaps.borrow_mut();
                    bitmaps.calls = bitmaps.calls.saturating_add(1);
                    if bitmaps.calls > 10_000 {
                        return Err(error("operation limit"));
                    }
                    if bitmaps.values.get(upload.id).is_none() {
                        return Err(error("invalid owner"));
                    }
                    // Charge the complete input copy and worst-case destination writes
                    // before reading native elements or mutating the bitmap.
                    bitmaps.charge(
                        count
                            .checked_mul(2)
                            .ok_or_else(|| error("pixel work limit"))?,
                    )?;
                    let length = u32::try_from(length).map_err(|_error| error("pixels limit"))?;
                    let bytes = (0..length)
                        .map(|index| input.as_object().get::<_, u8>(index))
                        .collect::<rquickjs::Result<Vec<_>>>()
                        .map_err(|failure| error(&format!("pixel input: {failure}")))?;
                    upload.write(
                        bitmaps
                            .values
                            .get_mut(upload.id)
                            .ok_or_else(|| error("invalid owner"))?,
                        &bytes,
                    )
                };
                run().map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
            },
        )?,
    )
}
