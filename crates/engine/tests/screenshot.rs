//! Viewport screenshots paint laid-out background colors.

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

const BOXES: &str = "<!doctype html><style>html,body{margin:0;padding:0;background-color:#00ff00}#box{width:20px;height:10px;background-color:#ff0000}</style><div id=box>marker</div>";
const BODY: &str = "<!doctype html><style>html,body{margin:0;padding:0}body{background-color:#0000ff}#box{width:20px;height:10px;background-color:#ff0000}</style><div id=box>marker</div>";

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
        assert!(shot.omitted.contains(&"glyphs"));
        assert!(shot.omitted.contains(&"replaced images"));
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
