//! Bounded native sRGB software bitmaps; no GPU or alternate browser backend.
use std::{cell::RefCell, rc::Rc};

use rquickjs::{Ctx, Exception, Function, IntoJs, TypedArray, Value as JsValue};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Error, Result};

mod bitmap;
mod pixels;

fn error(detail: &str) -> Error {
    Error::Dom(format!("canvas: {detail}"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    operation: String,
    #[serde(default)]
    id: usize,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    color: String,
    #[serde(default)]
    alpha: Option<f64>,
    #[serde(default)]
    opaque: bool,
    #[serde(default)]
    rect: [f64; 4],
    #[serde(default)]
    read: [i32; 4],
}
#[derive(Default)]
struct Bitmaps {
    values: Vec<bitmap::Bitmap>,
    pixels: usize,
    work: usize,
    calls: usize,
}
impl Bitmaps {
    fn charge(&mut self, count: usize) -> Result<()> {
        let work = self
            .work
            .checked_add(count)
            .ok_or_else(|| error("pixel work limit"))?;
        if work > 16_777_216 {
            return Err(error("pixel work limit"));
        }
        self.work = work;
        Ok(())
    }
    fn allocate(&mut self, request: &Request) -> Result<Value> {
        let count = bitmap::count(request.width, request.height)?;
        let old = if request.operation == "resize" {
            self.values
                .get(request.id)
                .ok_or_else(|| error("invalid owner"))?
                .pixels
                .len()
        } else {
            0
        };
        let total = self
            .pixels
            .saturating_sub(old)
            .checked_add(count)
            .ok_or_else(|| error("memory limit"))?;
        if total > 4_194_304 {
            return Err(error("memory limit"));
        }
        if request.operation == "create" && self.values.len() >= 64 {
            return Err(error("owners limit"));
        }
        self.charge(count)?;
        let mut value = bitmap::Bitmap::new(request.width, request.height)?;
        let id = if request.operation == "resize" {
            let old = self
                .values
                .get_mut(request.id)
                .ok_or_else(|| error("invalid owner"))?;
            value.opaque = old.opaque;
            value.reset();
            *old = value;
            request.id
        } else {
            let id = self.values.len();
            self.values.push(value);
            id
        };
        self.pixels = total;
        Ok(json!(id))
    }
    fn bytes(&mut self, request: &Request) -> Result<Vec<u8>> {
        let [_, _, width, height] = request.read;
        let count = bitmap::count(width.unsigned_abs(), height.unsigned_abs())?;
        self.charge(count)?;
        if request.operation == "image" {
            return Ok(vec![
                0;
                count
                    .checked_mul(4)
                    .ok_or_else(|| error("pixels limit"))?
            ]);
        }
        self.values
            .get(request.id)
            .ok_or_else(|| error("invalid owner"))?
            .read(request.read)
    }
    fn operate(&mut self, request: &Request) -> Result<Value> {
        if matches!(request.operation.as_str(), "create" | "resize") {
            return self.allocate(request);
        }
        if matches!(request.operation.as_str(), "fill" | "clear") {
            let (edges, bounds) = self
                .values
                .get(request.id)
                .ok_or_else(|| error("invalid owner"))?
                .clipped(request.rect)?;
            let [left, top, right, bottom] = bounds;
            let count = bitmap::count(right.saturating_sub(left), bottom.saturating_sub(top))?;
            self.charge(count)?;
            self.values
                .get_mut(request.id)
                .ok_or_else(|| error("invalid owner"))?
                .paint(edges, bounds, request.operation == "clear")?;
            return Ok(Value::Null);
        }
        if matches!(request.operation.as_str(), "reset" | "context") {
            let count = self
                .values
                .get(request.id)
                .ok_or_else(|| error("invalid owner"))?
                .pixels
                .len();
            self.charge(count)?;
        }
        let value = self
            .values
            .get_mut(request.id)
            .ok_or_else(|| error("invalid owner"))?;
        if request.operation == "context" {
            value.opaque = request.opaque;
            value.reset();
            return Ok(Value::Null);
        }
        value.settings(&request.operation, &request.color, request.alpha)
    }
}

pub(crate) fn install<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<()> {
    let bitmaps = Rc::new(RefCell::new(Bitmaps::default()));
    ctx.globals().set(
        "nimboCanvas",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, source: String| -> rquickjs::Result<JsValue<'js>> {
                let run = || -> Result<(Option<Vec<u8>>, Option<String>)> {
                    if source.len() > 8192 {
                        return Err(error("input limit"));
                    }
                    let request: Request = serde_json::from_str(&source)?;
                    let mut bitmaps = bitmaps.borrow_mut();
                    bitmaps.calls = bitmaps.calls.saturating_add(1);
                    if bitmaps.calls > 10_000 {
                        return Err(error("operation limit"));
                    }
                    if matches!(request.operation.as_str(), "read" | "image") {
                        return Ok((Some(bitmaps.bytes(&request)?), None));
                    }
                    Ok((
                        None,
                        Some(serde_json::to_string(&bitmaps.operate(&request)?)?),
                    ))
                };
                let (bytes, json) =
                    run().map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?;
                if let Some(bytes) = bytes {
                    return Ok(TypedArray::new(ctx.clone(), bytes)?.into_value());
                }
                json.unwrap_or_default().into_js(&ctx)
            },
        )?,
    )
}
