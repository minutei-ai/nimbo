//! Async classic scripts share a real origin with parser and lifecycle requests.

use nimbo_engine::{Browser, Limits};
use serde_json::json;
use std::{
    io,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use tiny_http::{Header, Request, Response, Server};

fn respond(request: Request, body: &str, content_type: &str) -> io::Result<()> {
    let header = Header::from_bytes("Content-Type", content_type)
        .map_err(|()| io::Error::other("invalid fixture header"))?;
    request.respond(Response::from_string(body).with_header(header))
}

#[test]
fn async_scripts_do_not_block_parser_or_dom_content_loaded()
-> Result<(), Box<dyn std::error::Error>> {
    let server = Server::http("127.0.0.1:0").map_err(io::Error::other)?;
    let origin = format!("http://{}", server.server_addr());
    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = Arc::clone(&stop);
    let worker = thread::spawn(move || -> io::Result<()> {
        let mut slow = None;
        let mut fast = None;
        let mut parsed = false;
        let mut fast_ran = false;
        while !server_stop.load(Ordering::Relaxed) {
            if let Some(request) = server.recv_timeout(Duration::from_millis(10))? {
                match request.url() {
                    "/slow.js" => slow = Some(request),
                    "/fast.js" => fast = Some(request),
                    "/parsed" => {
                        parsed = true;
                        respond(request, "parsed", "text/plain")?;
                    }
                    "/fast-ran" => {
                        fast_ran = true;
                        respond(request, "released", "text/plain")?;
                    }
                    "/" => respond(
                        request,
                        "<script>globalThis.order=[];document.addEventListener('DOMContentLoaded',()=>{order.push('dom');fetch('/parsed')});addEventListener('load',()=>order.push('load'))</script><script async src='/slow.js'></script><script async defer src='/fast.js'></script><script>order.push('parser')</script>",
                        "text/html",
                    )?,
                    _ => return Err(io::Error::other("unexpected fixture request")),
                }
            }
            if parsed && let Some(request) = fast.take() {
                respond(
                    request,
                    "order.push('fast');fetch('/fast-ran')",
                    "text/javascript",
                )?;
            }
            if fast_ran && let Some(request) = slow.take() {
                respond(request, "order.push('slow')", "text/javascript")?;
            }
        }
        Ok(())
    });
    let result = Browser::new(&origin, Limits::default())
        .and_then(|browser| browser.navigate(&origin))
        .and_then(|page| page.evaluate("({order,ready:document.readyState})"));
    stop.store(true, Ordering::Relaxed);
    worker
        .join()
        .map_err(|_panic| io::Error::other("fixture server panicked"))??;
    assert_eq!(
        result?,
        json!({"order":["parser","dom","fast","slow","load"],"ready":"complete"})
    );
    Ok(())
}
