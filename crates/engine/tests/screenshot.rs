//! Viewport screenshots paint laid-out boxes, glyphs, images, borders and shadows.

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

const BOXES: &str = "<!doctype html><style>html,body{margin:0;padding:0;background-color:#00ff00}#box{width:20px;height:10px;background-color:#ff0000;color:#ff0000}</style><div id=box>marker</div>";
const BODY: &str = "<!doctype html><style>html,body{margin:0;padding:0}body{background-color:#0000ff}#box{width:20px;height:10px;background-color:#ff0000;color:#ff0000}</style><div id=box>marker</div>";
const PICTURE: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP4z8DwH4Sh1H8G0gUALFAf4TOCTgoAAAAASUVORK5CYII=";
const FEATURES: &str = "<!doctype html><style>html,body{margin:0;padding:0;background:#00ff00}#back{position:absolute;left:0;top:0;width:12px;height:12px;background:#ff0000;z-index:2}#front{position:absolute;left:4px;top:4px;width:12px;height:12px;background:#0000ff;z-index:1}#edge{position:absolute;left:24px;top:0;width:10px;height:10px;background:#ff0000;border:4px solid #0000ff;box-shadow:8px 0 0 #ff00ff}#shown{position:absolute;left:0;top:20px;width:10px;height:8px;background:#ff0000}#hid{position:absolute;left:0;top:20px;width:10px;height:8px;background:#0000ff;visibility:hidden;z-index:5}#ink{position:absolute;left:24px;top:22px;width:24px;height:24px;background:#fff;color:#000;font-size:20px;font-family:sans-serif}#pic{position:absolute;left:52px;top:20px;width:8px;height:8px}#host{position:absolute;left:4px;top:36px;width:16px;height:10px;background:#fff}</style><div id=back></div><div id=front></div><div id=edge></div><div id=shown></div><div id=hid></div><div id=ink>M</div><img id=pic alt=\"\" src=\"PICTURE\"><div id=host></div>";

fn respond(request: Request, body: &str) -> io::Result<()> {
    let header = Header::from_bytes("Content-Type", "text/html")
        .map_err(|()| io::Error::other("invalid fixture header"))?;
    request.respond(Response::from_string(body).with_header(header))
}

fn whole(value: f64) -> Result<u32, Box<dyn std::error::Error>> {
    if !value.is_finite() {
        return Err("non-finite screenshot coordinate".into());
    }
    let text = format!("{:.0}", value.floor().clamp(0.0, 4096.0));
    Ok(text.parse()?)
}

fn sample(png: &[u8], x: u32, y: u32) -> Result<[u8; 4], Box<dyn std::error::Error>> {
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

fn geometry(page: &nimbo_engine::Page) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(page.evaluate(
        "(()=>{const box=document.querySelector('#box');const rect=box.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,color:getComputedStyle(box).backgroundColor,body:getComputedStyle(document.body).backgroundColor,root:getComputedStyle(document.documentElement).backgroundColor};})()",
    )?)
}

#[test]
fn screenshot_paints_layout_background_colors() -> Result<(), Box<dyn std::error::Error>> {
    let server = Server::http("127.0.0.1:0").map_err(io::Error::other)?;
    let origin = format!("http://{}", server.server_addr());
    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = Arc::clone(&stop);
    let worker = thread::spawn(move || -> io::Result<()> {
        while !server_stop.load(Ordering::Relaxed) {
            if let Some(request) = server.recv_timeout(Duration::from_millis(10))? {
                match request.url() {
                    "/boxes" => respond(request, BOXES)?,
                    "/body" => respond(request, BODY)?,
                    _ => return Err(io::Error::other("unexpected fixture request")),
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
        let boxes = browser.navigate(&format!("{origin}/boxes"))?;
        let placed = geometry(&boxes)?;
        assert_eq!(
            placed,
            json!({"x":0,"y":0,"width":20,"height":10,"color":"rgb(255, 0, 0)","body":"rgb(0, 255, 0)","root":"rgb(0, 255, 0)"})
        );
        let shot = boxes.screenshot()?;
        assert_eq!((shot.width, shot.height), (64, 48));
        assert_eq!(
            shot.png.get(..8),
            Some([0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'].as_slice())
        );
        assert!(shot.omitted.is_empty());
        let inside_x = whole(number(&placed, "x")?)?
            .checked_add(1)
            .ok_or("box pixel")?;
        let inside_y = whole(number(&placed, "y")?)?
            .checked_add(1)
            .ok_or("box pixel")?;
        assert_eq!(sample(&shot.png, inside_x, inside_y)?, [255, 0, 0, 255]);
        assert_eq!(sample(&shot.png, 40, 30)?, [0, 255, 0, 255]);
        drop(boxes);

        let propagated = browser.navigate(&format!("{origin}/body"))?;
        let body = geometry(&propagated)?;
        assert_eq!(
            body.get("root").and_then(Value::as_str),
            Some("rgba(0, 0, 0, 0)")
        );
        assert_eq!(
            body.get("body").and_then(Value::as_str),
            Some("rgb(0, 0, 255)")
        );
        let shot = propagated.screenshot()?;
        let inside_x = whole(number(&body, "x")?)?
            .checked_add(1)
            .ok_or("box pixel")?;
        let inside_y = whole(number(&body, "y")?)?
            .checked_add(1)
            .ok_or("box pixel")?;
        assert_eq!(sample(&shot.png, inside_x, inside_y)?, [255, 0, 0, 255]);
        assert_eq!(sample(&shot.png, 40, 30)?, [0, 0, 255, 255]);
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

fn rect(value: &Value, name: &str) -> Result<(u32, u32, u32, u32), Box<dyn std::error::Error>> {
    let item = value.get(name).ok_or_else(|| format!("missing {name}"))?;
    Ok((
        whole(number(item, "x")?)?,
        whole(number(item, "y")?)?,
        whole(number(item, "width")?)?,
        whole(number(item, "height")?)?,
    ))
}

fn expect_features(png: &[u8], placed: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let (back_x, back_y, back_w, back_h) = rect(placed, "back")?;
    let (front_x, front_y, front_w, front_h) = rect(placed, "front")?;
    let overlap_x = inside(back_x.max(front_x), back_w.min(front_w), 1)?;
    let overlap_y = inside(back_y.max(front_y), back_h.min(front_h), 1)?;
    assert_eq!(sample(png, overlap_x, overlap_y)?, [255, 0, 0, 255]);
    let past_back = back_x
        .saturating_add(back_w)
        .saturating_sub(front_x)
        .saturating_add(1);
    let later_only = inside(front_x, front_w, past_back)?;
    assert_eq!(
        sample(png, later_only, inside(front_y, front_h, 1)?)?,
        [0, 0, 255, 255]
    );
    let (edge_x, edge_y, edge_w, edge_h) = rect(placed, "edge")?;
    assert_eq!(
        sample(png, inside(edge_x, edge_w, 1)?, inside(edge_y, edge_h, 1)?)?,
        [0, 0, 255, 255]
    );
    assert_eq!(
        sample(png, inside(edge_x, edge_w, 5)?, inside(edge_y, edge_h, 5)?)?,
        [255, 0, 0, 255]
    );
    let shadow_x = edge_x
        .checked_add(edge_w)
        .and_then(|value| value.checked_add(1))
        .ok_or("shadow pixel")?;
    assert_eq!(
        sample(png, shadow_x, inside(edge_y, edge_h, 1)?)?,
        [255, 0, 255, 255]
    );
    let (shown_x, shown_y, shown_w, shown_h) = rect(placed, "shown")?;
    assert_eq!(
        sample(
            png,
            inside(shown_x, shown_w, 1)?,
            inside(shown_y, shown_h, 1)?
        )?,
        [255, 0, 0, 255]
    );
    let (pic_x, pic_y, pic_w, pic_h) = rect(placed, "pic")?;
    let half = pic_w.checked_div(2).ok_or("image column")?;
    assert_eq!(
        sample(png, inside(pic_x, pic_w, 1)?, inside(pic_y, pic_h, 1)?)?,
        [255, 0, 0, 255]
    );
    assert_eq!(
        sample(
            png,
            inside(pic_x, pic_w, half.checked_add(1).ok_or("image column")?)?,
            inside(pic_y, pic_h, 1)?,
        )?,
        [0, 0, 255, 255]
    );
    expect_ink_and_host(png, placed)
}

fn expect_ink_and_host(png: &[u8], placed: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let (ink_x, ink_y, ink_w, ink_h) = rect(placed, "ink")?;
    let mut ink = false;
    let mut paper = false;
    for y in ink_y..ink_y.saturating_add(ink_h) {
        for x in ink_x..ink_x.saturating_add(ink_w) {
            let pixel = sample(png, x, y)?;
            ink |= pixel[0] < 40 && pixel[1] < 40 && pixel[2] < 40;
            paper |= pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240;
        }
    }
    assert!(ink, "glyph ink missing inside the text box");
    assert!(paper, "text box has no unpainted paper");
    let (host_x, host_y, host_w, host_h) = rect(placed, "host")?;
    assert_eq!(
        sample(png, inside(host_x, host_w, 2)?, inside(host_y, host_h, 2)?)?,
        [255, 0, 255, 255]
    );
    assert_eq!(sample(png, 63, 47)?, [0, 255, 0, 255]);
    Ok(())
}

fn inside(origin: u32, span: u32, offset: u32) -> Result<u32, Box<dyn std::error::Error>> {
    origin
        .checked_add(offset)
        .filter(|pixel| offset < span && *pixel < 64)
        .ok_or_else(|| format!("pixel {origin}+{offset} outside {span}").into())
}

#[test]
fn screenshot_paints_glyphs_images_borders_shadows_and_stacking()
-> Result<(), Box<dyn std::error::Error>> {
    let server = Server::http("127.0.0.1:0").map_err(io::Error::other)?;
    let origin = format!("http://{}", server.server_addr());
    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = Arc::clone(&stop);
    let worker = thread::spawn(move || -> io::Result<()> {
        while !server_stop.load(Ordering::Relaxed) {
            if let Some(request) = server.recv_timeout(Duration::from_millis(10))? {
                if request.url() == "/features" {
                    respond(request, &FEATURES.replace("PICTURE", PICTURE))?;
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
        let page = browser.navigate(&format!("{origin}/features"))?;
        let placed = page.evaluate(
            "(()=>{const box=id=>{const node=document.getElementById(id);const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};};const pic=document.getElementById('pic');const frame=box('pic');frame.nw=pic.naturalWidth;frame.nh=pic.naturalHeight;return {back:box('back'),front:box('front'),edge:box('edge'),shown:box('shown'),ink:box('ink'),host:box('host'),pic:frame};})()",
        )?;
        assert_eq!(
            (
                number(placed.get("pic").ok_or("pic")?, "nw")?,
                number(placed.get("pic").ok_or("pic")?, "nh")?,
            ),
            (4.0, 4.0)
        );
        page.evaluate(
            "(()=>{const host=document.getElementById('host');const root=host.attachShadow({mode:'open'});root.innerHTML='<div style=\"width:16px;height:10px;background-color:#ff00ff\"></div>';return root.querySelector('div').style.backgroundColor;})()",
        )?;
        let shot = page.screenshot()?;
        assert!(shot.omitted.is_empty());
        expect_features(&shot.png, &placed)?;
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
