//! Native session semantics: one `Browser` is one session, over real HTTP.

use nimbo_engine::{Browser, CancellationToken, Error, Limits};
use serde_json::json;
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Requests seen by the origin as `(path, Cookie header)`.
type Seen = Arc<Mutex<Vec<(String, String)>>>;

struct Origin {
    url: String,
    seen: Seen,
    stop: Arc<AtomicBool>,
    stalled: mpsc::Receiver<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for Origin {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            #[expect(
                clippy::let_underscore_must_use,
                reason = "A panicked fixture thread already failed its connection"
            )]
            let _ = thread.join();
        }
    }
}

fn origin() -> io::Result<Origin> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let url = format!("http://{}/", listener.local_addr()?);
    let seen = Seen::default();
    let stop = Arc::new(AtomicBool::new(false));
    let (stalling, stalled) = mpsc::channel();
    let thread = {
        let (seen, stop) = (Arc::clone(&seen), Arc::clone(&stop));
        thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (seen, stalling) = (Arc::clone(&seen), stalling.clone());
                        thread::spawn(move || {
                            #[expect(
                                clippy::let_underscore_must_use,
                                reason = "Cancelled clients close sockets deliberately"
                            )]
                            let _ = respond(stream, &seen, &stalling);
                        });
                    }
                    Err(_) => thread::sleep(Duration::from_millis(1)),
                }
            }
        })
    };
    Ok(Origin {
        url,
        seen,
        stop,
        stalled,
        thread: Some(thread),
    })
}

fn respond(mut stream: TcpStream, seen: &Seen, stalling: &mpsc::Sender<()>) -> io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let path = line.split(' ').nth(1).unwrap_or_default().to_owned();
    let mut cookie = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" {
            break;
        }
        if let Some(value) = line.strip_prefix("cookie: ") {
            value.trim_end().clone_into(&mut cookie);
        }
    }
    seen.lock()
        .map_err(|_poisoned| io::Error::other("seen lock"))?
        .push((path.clone(), cookie));
    let (set_cookie, body) = match path.as_str() {
        "/login" => (
            "sid=one; Path=/",
            "<script>localStorage.setItem('k','one')</script>",
        ),
        "/expire" => ("sid=; Path=/; Max-Age=0", "<title>expired</title>"),
        "/stall" => {
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nSet-Cookie: late=1; Path=/\r\nContent-Length: 1000000\r\n\r\n<title>")?;
            stalling.send(()).map_err(io::Error::other)?;
            let mut byte = [0_u8; 1];
            // Hold the partial response until the cancelled client closes it.
            while stream.read(&mut byte)? != 0 {}
            return Ok(());
        }
        _ => ("", "<title>page</title>"),
    };
    let header = if set_cookie.is_empty() {
        String::new()
    } else {
        format!("Set-Cookie: {set_cookie}\r\n")
    };
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{header}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn cookies(origin: &Origin, path: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    Ok(origin
        .seen
        .lock()
        .map_err(|_poisoned| "seen lock")?
        .iter()
        .filter(|(seen, _)| seen == path)
        .map(|(_, cookie)| cookie.clone())
        .collect())
}

const STATE: &str = "[document.cookie, localStorage.getItem('k')]";

#[test]
fn session_state_persists_per_browser_and_tenants_stay_isolated() -> TestResult {
    let origin = origin()?;
    let tenant = Browser::new(&origin.url, Limits::default())?;
    let other = Browser::new(&origin.url, Limits::default())?;
    tenant.navigate(&format!("{}login", origin.url))?;
    let page = tenant.navigate(&origin.url)?;
    assert_eq!(page.evaluate(STATE)?, json!(["sid=one", "one"]));
    let timings = page.timings();
    assert!(timings.request > Duration::ZERO && timings.initialization > Duration::ZERO);
    assert!(timings.request + timings.initialization + timings.execution < Duration::from_secs(10));
    let isolated = other.navigate(&origin.url)?;
    assert_eq!(isolated.evaluate(STATE)?, json!(["", null]));
    assert_eq!(cookies(&origin, "/")?, ["sid=one", ""]);
    Ok(())
}

#[test]
fn overlapping_pages_share_one_session_in_program_order() -> TestResult {
    let origin = origin()?;
    let browser = Browser::new(&origin.url, Limits::default())?;
    let first = browser.navigate(&origin.url)?;
    let second = browser.navigate(&origin.url)?;
    first.evaluate("(localStorage.setItem('k','first'), document.cookie='js=1')")?;
    assert_eq!(second.evaluate(STATE)?, json!(["js=1", "first"]));
    second.evaluate("localStorage.setItem('k','second')")?;
    assert_eq!(first.evaluate(STATE)?, json!(["js=1", "second"]));
    browser.navigate(&origin.url)?;
    assert_eq!(
        cookies(&origin, "/")?.last().map(String::as_str),
        Some("js=1")
    );
    Ok(())
}

#[test]
fn clearing_and_expiry_end_session_state_for_live_and_later_pages() -> TestResult {
    let origin = origin()?;
    let browser = Browser::new(&origin.url, Limits::default())?;
    browser.navigate(&format!("{}login", origin.url))?;
    let live = browser.navigate(&origin.url)?;
    browser.clear_session();
    assert_eq!(live.evaluate(STATE)?, json!(["", null]));
    browser.navigate(&origin.url)?;
    browser.navigate(&format!("{}login", origin.url))?;
    browser.navigate(&format!("{}expire", origin.url))?;
    browser.navigate(&origin.url)?;
    assert_eq!(cookies(&origin, "/")?, ["sid=one", "", ""]);
    Ok(())
}

#[test]
fn cancellation_keeps_received_session_state_and_the_browser_recovers() -> TestResult {
    let origin = origin()?;
    let browser = Browser::new(&origin.url, Limits::default())?;
    browser.navigate(&format!("{}login", origin.url))?;
    let token = CancellationToken::new();
    let stop = token.clone();
    let cancelling = thread::spawn(move || {
        thread::sleep(Duration::from_millis(200));
        stop.cancel();
    });
    let started = Instant::now();
    let result = browser.navigate_with_cancel(&format!("{}stall", origin.url), &token);
    cancelling
        .join()
        .map_err(|_panic| "cancelling thread panicked")?;
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(2));
    origin.stalled.recv_timeout(Duration::from_secs(1))?;
    let page = browser.navigate(&origin.url)?;
    // Headers already received stay committed, as in browsers.
    assert_eq!(page.evaluate(STATE)?, json!(["sid=one; late=1", "one"]));
    Ok(())
}
