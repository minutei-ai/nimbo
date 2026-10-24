//! A tall page becomes a real PDF whose first page matches the screenshot.

use std::{
    io,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use nimbo_engine::{Browser, Limits, MediaEnvironment};
use serde_json::{Value, json};
use tiny_http::{Header, Request, Response, Server};

const PAGE: &str = "<!doctype html><style>html,body{margin:0;padding:0;background:#00ff00}#top{position:absolute;left:0;top:0;width:20px;height:10px;background:#ff0000}#fold{position:absolute;left:0;top:60px;width:20px;height:10px;background:#0000ff}</style><div id=top></div><div id=fold></div>";

fn respond(request: Request, body: &str) -> io::Result<()> {
    let header = Header::from_bytes("Content-Type", "text/html")
        .map_err(|()| io::Error::other("invalid fixture header"))?;
    request.respond(Response::from_string(body).with_header(header))
}

fn whole(value: f64) -> Result<u32, Box<dyn std::error::Error>> {
    if !value.is_finite() {
        return Err("non-finite pdf coordinate".into());
    }
    let text = format!("{:.0}", value.floor().clamp(0.0, 4096.0));
    Ok(text.parse()?)
}

fn sample_png(png: &[u8], x: u32, y: u32) -> Result<[u8; 4], Box<dyn std::error::Error>> {
    let image = image::load_from_memory(png)?.into_rgba8();
    image
        .get_pixel_checked(x, y)
        .map(|pixel| pixel.0)
        .ok_or_else(|| "pixel outside screenshot".into())
}

fn number(value: &Value, name: &str) -> Result<f64, Box<dyn std::error::Error>> {
    value
        .get(name)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("missing {name}").into())
}

fn page_objects(pdf: &[u8]) -> usize {
    let marker = b"/Type /Page";
    let mut count = 0_usize;
    let mut rest = pdf;
    while let Some(found) = rest
        .windows(marker.len())
        .position(|window| window == marker)
    {
        let next = found.saturating_add(marker.len());
        if rest.get(next) != Some(&b's') {
            count = count.saturating_add(1);
        }
        rest = rest.get(next..).unwrap_or_default();
    }
    count
}

fn pdf_images(pdf: &[u8]) -> Result<Vec<Vec<[u8; 3]>>, Box<dyn std::error::Error>> {
    let mut images = Vec::new();
    let marker = b"/Subtype /Image";
    let mut rest = pdf;
    while let Some(found) = rest
        .windows(marker.len())
        .position(|window| window == marker)
    {
        let after = rest.get(found..).ok_or("truncated pdf image")?;
        let stream_at = after
            .windows(7)
            .position(|window| window == b"stream\n")
            .ok_or("pdf image has no stream")?;
        let data = after
            .get(stream_at.saturating_add(7)..)
            .ok_or("truncated pdf stream")?;
        let end = data
            .windows(10)
            .position(|window| window == b"\nendstream")
            .ok_or("pdf stream is not closed")?;
        let encoded = data.get(..end).ok_or("truncated pdf stream")?;
        images.push(decode_hex(encoded)?);
        rest = data.get(end..).unwrap_or_default();
    }
    Ok(images)
}

fn decode_hex(encoded: &[u8]) -> Result<Vec<[u8; 3]>, Box<dyn std::error::Error>> {
    let mut nibbles = Vec::new();
    for byte in encoded {
        match byte {
            b'0'..=b'9' => nibbles.push(byte.checked_sub(b'0').ok_or("pdf hex")?),
            b'A'..=b'F' => nibbles.push(
                byte.checked_sub(b'A')
                    .and_then(|value| value.checked_add(10))
                    .ok_or("pdf hex")?,
            ),
            b'>' => break,
            b' ' | b'\n' | b'\r' | b'\t' => {}
            _ => return Err("pdf hex".into()),
        }
    }
    if nibbles.len().checked_rem(2) != Some(0) {
        return Err("pdf hex length".into());
    }
    let mut bytes = Vec::new();
    let mut index = 0_usize;
    while index < nibbles.len() {
        let hi = nibbles.get(index).copied().ok_or("pdf hex")?;
        let lo = nibbles
            .get(index.saturating_add(1))
            .copied()
            .ok_or("pdf hex")?;
        bytes.push(
            hi.checked_mul(16)
                .and_then(|value| value.checked_add(lo))
                .ok_or("pdf hex")?,
        );
        index = index.saturating_add(2);
    }
    if bytes.len().checked_rem(3) != Some(0) {
        return Err("pdf sample length".into());
    }
    let mut pixels = Vec::new();
    let mut index = 0_usize;
    while index < bytes.len() {
        pixels.push([
            bytes.get(index).copied().ok_or("pdf sample")?,
            bytes
                .get(index.saturating_add(1))
                .copied()
                .ok_or("pdf sample")?,
            bytes
                .get(index.saturating_add(2))
                .copied()
                .ok_or("pdf sample")?,
        ]);
        index = index.saturating_add(3);
    }
    Ok(pixels)
}

fn rgb_at(
    pixels: &[[u8; 3]],
    width: u32,
    x: u32,
    y: u32,
) -> Result<[u8; 3], Box<dyn std::error::Error>> {
    let index = y
        .checked_mul(width)
        .and_then(|row| row.checked_add(x))
        .ok_or("pdf pixel")?;
    pixels
        .get(usize::try_from(index).map_err(|_error| "pdf pixel")?)
        .copied()
        .ok_or_else(|| "pdf pixel".into())
}

#[test]
fn pdf_has_two_pages_and_page_one_matches_the_screenshot() -> Result<(), Box<dyn std::error::Error>>
{
    let server = Server::http("127.0.0.1:0").map_err(io::Error::other)?;
    let origin = format!("http://{}", server.server_addr());
    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = Arc::clone(&stop);
    let worker = thread::spawn(move || -> io::Result<()> {
        while !server_stop.load(Ordering::Relaxed) {
            if let Some(request) = server.recv_timeout(Duration::from_millis(10))? {
                if request.url() == "/tall" {
                    respond(request, PAGE)?;
                } else {
                    return Err(io::Error::other("unexpected fixture request"));
                }
            }
        }
        Ok(())
    });
    let media = MediaEnvironment {
        width: 64,
        height: 48,
        ..MediaEnvironment::default()
    };
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let browser = Browser::with_media(&origin, Limits::default(), media)?;
        let page = browser.navigate(&format!("{origin}/tall"))?;
        let placed = page.evaluate(
            "(()=>{const box=id=>{const node=document.getElementById(id);const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};};return {top:box('top'),fold:box('fold')};})()",
        )?;
        assert_eq!(
            placed.get("top"),
            Some(&json!({"x":0,"y":0,"width":20,"height":10}))
        );
        let fold = placed.get("fold").ok_or("fold")?;
        let fold_y = whole(number(fold, "y")?)?;
        assert!(fold_y >= 48, "fold box stayed in the viewport at {fold_y}");
        let shot = page.screenshot()?;
        assert_eq!(sample_png(&shot.png, 1, 1)?, [255, 0, 0, 255]);
        assert_eq!(sample_png(&shot.png, 40, 30)?, [0, 255, 0, 255]);
        let pdf = page.pdf()?;
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.windows(5).any(|window| window == b"%%EOF"));
        assert!(pdf.len() > 32, "header-only pdf");
        let pages = page_objects(&pdf);
        assert!(pages >= 2, "pdf page count {pages}");
        let images = pdf_images(&pdf)?;
        assert_eq!(images.len(), pages);
        let first = images.first().ok_or("missing first pdf page")?;
        assert_eq!(
            first.len(),
            usize::try_from(shot.width)
                .ok()
                .and_then(|width| usize::try_from(shot.height)
                    .ok()
                    .and_then(|height| width.checked_mul(height)))
                .ok_or("screenshot size")?
        );
        for y in 0..shot.height {
            for x in 0..shot.width {
                let png = sample_png(&shot.png, x, y)?;
                assert_eq!(
                    rgb_at(first, shot.width, x, y)?,
                    [png[0], png[1], png[2]],
                    "page one pixel {x},{y}"
                );
            }
        }
        let fold_x = whole(number(fold, "x")?)?
            .checked_add(1)
            .ok_or("fold pixel")?;
        let page_index = usize::try_from(fold_y.checked_div(shot.height).ok_or("fold page")?)?;
        let local = fold_y.checked_rem(shot.height).ok_or("fold row")?;
        let local = local.checked_add(1).ok_or("fold pixel")?;
        let fold_page = images.get(page_index).ok_or("fold page missing")?;
        assert_eq!(rgb_at(fold_page, shot.width, fold_x, local)?, [0, 0, 255]);
        assert_ne!(rgb_at(first, shot.width, fold_x, local)?, [0, 0, 255]);
        Ok(())
    })();
    stop.store(true, Ordering::Relaxed);
    let joined = worker.join();
    let server_result = match joined {
        Ok(result) => result,
        Err(_panic) => Err(io::Error::other("fixture server panicked")),
    };
    result.and(server_result.map_err(Into::into))
}
