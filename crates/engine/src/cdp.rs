//! Loopback `CDP` session driven by one `Playwright` client.
//!
//! The worker thread owns the browser. `Playwright` connects to the `HTTP`
//! endpoint, opens a page, and evaluates it. This is not a Chrome debugger.

#[path = "cdp_dispatch.rs"]
mod dispatch;
#[path = "cdp_ws.rs"]
mod ws;

use std::{
    io::{self, ErrorKind, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        Mutex,
        mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError},
    },
    thread,
    time::Duration,
};

use serde_json::{Value, json};

use crate::{Browser, Error, Limits, Page, Result};

const POLL: Duration = Duration::from_millis(5);
const MAX_MESSAGE: usize = 8 * 1024 * 1024;

/// Loopback debugger session that one `Playwright` client can drive.
///
/// The worker owns one browser. Cookies set by a page stay visible to the next
/// navigation in the same session. The socket speaks the `connectOverCDP`,
/// `newPage`, `goto`, and `evaluate` commands `Playwright` 1.64 sends. Other
/// `CDP` methods get an empty result so that client can finish connecting.
/// This is not a Chrome debugger.
#[derive(Debug)]
pub struct Session {
    endpoint: String,
    jobs: Sender<Job>,
    thread: Mutex<Option<thread::JoinHandle<()>>>,
}

struct Drive {
    browser: Browser,
    page: Option<Page>,
    frame_id: String,
    frame_url: String,
    origin: String,
    loader_id: String,
    loader_serial: u64,
    context: i64,
    scripts: u64,
    target_serial: u64,
}

enum Job {
    Navigate {
        url: String,
        reply: Sender<std::result::Result<(), String>>,
    },
    Evaluate {
        expression: String,
        reply: Sender<std::result::Result<Value, String>>,
    },
    Stop,
}

struct Client {
    stream: TcpStream,
    buffer: Vec<u8>,
    pending: Vec<u8>,
    collecting: bool,
}

impl Session {
    /// Binds `127.0.0.1` and starts the worker that owns the browser.
    ///
    /// `origin` is the only document origin the browser will load.
    ///
    /// # Errors
    ///
    /// Returns an error when the port cannot be bound or the browser cannot start.
    pub fn open(origin: &str, limits: Limits) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let endpoint = format!("http://127.0.0.1:{port}");
        let (jobs, incoming) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let origin = origin.to_owned();
        let thread = thread::Builder::new()
            .name("nimbo-cdp".to_owned())
            .spawn(move || worker(&listener, &origin, limits, &incoming, &ready_tx, port))?;
        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                endpoint,
                jobs,
                thread: Mutex::new(Some(thread)),
            }),
            other => {
                stop_and_join(&jobs, thread);
                Err(start_error(other))
            }
        }
    }

    /// `HTTP` endpoint passed to `Playwright`'s `connectOverCDP`.
    #[must_use]
    pub const fn endpoint(&self) -> &str {
        self.endpoint.as_str()
    }

    /// Loads `url` in this session.
    ///
    /// Cookies already stored for the origin stay available to the new page.
    ///
    /// # Errors
    ///
    /// Returns an error when the session is closed or the navigation fails.
    pub fn navigate(&self, url: &str) -> Result<()> {
        let (reply, incoming) = mpsc::channel();
        self.jobs
            .send(Job::Navigate {
                url: url.to_owned(),
                reply,
            })
            .map_err(|_closed| Error::Unsupported("session closed".into()))?;
        wait(&incoming)
    }

    /// Evaluates `expression` on the current page and returns `JSON`.
    ///
    /// # Errors
    ///
    /// Returns an error when the session is closed, no page is loaded, or JavaScript fails.
    pub fn evaluate(&self, expression: &str) -> Result<Value> {
        let (reply, incoming) = mpsc::channel();
        self.jobs
            .send(Job::Evaluate {
                expression: expression.to_owned(),
                reply,
            })
            .map_err(|_closed| Error::Unsupported("session closed".into()))?;
        wait(&incoming)
    }

    /// Closes the debugger socket and stops the worker.
    ///
    /// A command the client sends after this returns fails. Dropping the session closes it too.
    /// Calling `close` again does nothing.
    pub fn close(&self) {
        match self.jobs.send(Job::Stop) {
            Ok(()) => {}
            Err(_closed) => {}
        }
        let handle = match self.thread.lock() {
            Ok(mut guard) => guard.take(),
            Err(_poisoned) => None,
        };
        let Some(handle) = handle else {
            return;
        };
        match handle.join() {
            Ok(()) => {}
            Err(_panic) => {}
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

fn wait<T>(incoming: &Receiver<std::result::Result<T, String>>) -> Result<T> {
    match incoming.recv_timeout(Duration::from_mins(1)) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(message)) => Err(Error::Unsupported(message)),
        Err(RecvTimeoutError::Timeout) => Err(Error::Unsupported("session timed out".into())),
        Err(RecvTimeoutError::Disconnected) => Err(Error::Unsupported("session closed".into())),
    }
}

fn start_error(
    result: std::result::Result<std::result::Result<(), String>, RecvTimeoutError>,
) -> Error {
    let message = match result {
        Ok(Err(message)) => message,
        Ok(Ok(())) | Err(_) => "session did not start".to_owned(),
    };
    Error::Unsupported(message)
}

fn stop_and_join(jobs: &Sender<Job>, handle: thread::JoinHandle<()>) {
    match jobs.send(Job::Stop) {
        Ok(()) => {}
        Err(_closed) => {}
    }
    match handle.join() {
        Ok(()) => {}
        Err(_panic) => {}
    }
}

fn worker(
    listener: &TcpListener,
    origin: &str,
    limits: Limits,
    jobs: &Receiver<Job>,
    ready: &Sender<std::result::Result<(), String>>,
    port: u16,
) {
    if let Err(error) = listener.set_nonblocking(true) {
        report(ready, Err(error.to_string()));
        return;
    }
    let browser = match Browser::new(origin, limits) {
        Ok(browser) => browser,
        Err(error) => {
            report(ready, Err(error.to_string()));
            return;
        }
    };
    report(ready, Ok(()));
    serve(listener, port, fresh(browser), jobs);
}

fn report(
    ready: &Sender<std::result::Result<(), String>>,
    result: std::result::Result<(), String>,
) {
    match ready.send(result) {
        Ok(()) => {}
        Err(_closed) => {}
    }
}

fn fresh(browser: Browser) -> Drive {
    Drive {
        browser,
        page: None,
        frame_id: String::new(),
        frame_url: String::new(),
        origin: String::new(),
        loader_id: String::new(),
        loader_serial: 0,
        context: 1,
        scripts: 0,
        target_serial: 0,
    }
}

fn serve(listener: &TcpListener, port: u16, mut drive: Drive, jobs: &Receiver<Job>) {
    let mut client = None;
    loop {
        if !poll_job(&mut drive, jobs) {
            break;
        }
        if !turn(listener, port, &mut client, &mut drive) {
            break;
        }
    }
    shutdown_client(client);
}

fn turn(listener: &TcpListener, port: u16, client: &mut Option<Client>, drive: &mut Drive) -> bool {
    let read = client.as_mut().map(|current| read_client(current, drive));
    if let Some(read) = read {
        if !matches!(read, Ok(true)) {
            *client = None;
        }
        return true;
    }
    match accept_client(listener, port) {
        Ok(Some(next)) => {
            *client = Some(next);
            true
        }
        Ok(None) => {
            thread::sleep(POLL);
            true
        }
        Err(_error) => false,
    }
}

fn poll_job(drive: &mut Drive, jobs: &Receiver<Job>) -> bool {
    match jobs.try_recv() {
        Ok(Job::Stop) | Err(TryRecvError::Disconnected) => false,
        Err(TryRecvError::Empty) => true,
        Ok(Job::Navigate { url, reply }) => {
            answer(&reply, load(drive, &url));
            true
        }
        Ok(Job::Evaluate { expression, reply }) => {
            answer(&reply, read_page(drive, &expression));
            true
        }
    }
}

fn answer<T>(
    reply: &Sender<std::result::Result<T, String>>,
    result: std::result::Result<T, String>,
) {
    match reply.send(result) {
        Ok(()) => {}
        Err(_closed) => {}
    }
}

fn load(drive: &mut Drive, url: &str) -> std::result::Result<(), String> {
    let page = drive
        .browser
        .navigate(url)
        .map_err(|error| error.to_string())?;
    drive.page = Some(page);
    Ok(())
}

fn read_page(drive: &Drive, expression: &str) -> std::result::Result<Value, String> {
    let page = drive.page.as_ref().ok_or_else(|| "no page".to_owned())?;
    page.evaluate(expression).map_err(|error| error.to_string())
}

fn shutdown_client(client: Option<Client>) {
    let Some(client) = client else {
        return;
    };
    match client.stream.shutdown(Shutdown::Both) {
        Ok(()) => {}
        Err(_error) => {}
    }
}

fn accept_client(listener: &TcpListener, port: u16) -> io::Result<Option<Client>> {
    match listener.accept() {
        Ok((stream, _)) => match greet(stream, port) {
            Ok(client) => Ok(client),
            Err(_error) => Ok(None),
        },
        Err(error) if idle(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

fn greet(mut stream: TcpStream, port: u16) -> io::Result<Option<Client>> {
    prepare(&stream)?;
    let handshake = ws::read_handshake(&mut stream)?;
    let path = ws::request_target(&handshake.head).unwrap_or("/");
    if ws::is_version(path) {
        let body = version_body(port)?;
        finish_http(&mut stream, "200 OK", "application/json", &body)?;
        return Ok(None);
    }
    if !ws::is_websocket(&handshake.head) {
        finish_http(&mut stream, "404 Not Found", "text/plain", "not found")?;
        return Ok(None);
    }
    let key = ws::header(&handshake.head, "sec-websocket-key")
        .ok_or_else(|| io::Error::other("missing websocket key"))?;
    let accept = ws::accept_key(key).ok_or_else(|| io::Error::other("websocket accept"))?;
    stream.write_all(ws::upgrade(&accept).as_bytes())?;
    stream.flush()?;
    stream.set_read_timeout(Some(POLL))?;
    Ok(Some(Client {
        stream,
        buffer: handshake.rest,
        pending: Vec::new(),
        collecting: false,
    }))
}

fn prepare(stream: &TcpStream) -> io::Result<()> {
    stream.set_nodelay(true)?;
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    Ok(())
}

fn version_body(port: u16) -> io::Result<String> {
    serde_json::to_string(&json!({
        "Browser": "Chrome/120.0.0.0",
        "Protocol-Version": "1.3",
        "User-Agent": dispatch::DEBUGGER_AGENT,
        "V8-Version": "0.0.0",
        "WebKit-Version": "0.0.0",
        "webSocketDebuggerUrl": format!("ws://127.0.0.1:{port}/devtools/browser/session"),
    }))
    .map_err(io::Error::other)
}

fn finish_http(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
) -> io::Result<()> {
    stream.write_all(&ws::http_response(status, content_type, body))?;
    stream.flush()?;
    stream.shutdown(Shutdown::Write)
}

fn read_client(client: &mut Client, drive: &mut Drive) -> io::Result<bool> {
    let mut temp = [0_u8; 8192];
    match client.stream.read(&mut temp) {
        Ok(0) => Ok(false),
        Ok(count) => {
            append_chunk(client, &temp, count)?;
            dispatch_buffered(client, drive)
        }
        Err(error) if idle(&error) => Ok(true),
        Err(error) => Err(error),
    }
}

fn append_chunk(client: &mut Client, temp: &[u8], count: usize) -> io::Result<()> {
    let Some(chunk) = temp.get(..count) else {
        return Err(io::Error::other("short read"));
    };
    client.buffer.extend_from_slice(chunk);
    if client.buffer.len() > MAX_MESSAGE {
        Err(io::Error::other("websocket buffer is too large"))
    } else {
        Ok(())
    }
}

fn dispatch_buffered(client: &mut Client, drive: &mut Drive) -> io::Result<bool> {
    loop {
        let frame = ws::pop_frame(&mut client.buffer).map_err(io::Error::other)?;
        let Some(frame) = frame else {
            return Ok(true);
        };
        if !apply_frame(client, drive, frame)? {
            return Ok(false);
        }
    }
}

fn apply_frame(client: &mut Client, drive: &mut Drive, frame: ws::Frame) -> io::Result<bool> {
    match frame {
        ws::Frame::Ping(payload) => {
            client.stream.write_all(&ws::encode(10, &payload))?;
            client.stream.flush()?;
            Ok(true)
        }
        ws::Frame::Pong => Ok(true),
        ws::Frame::Close => Ok(false),
        ws::Frame::Data {
            fin,
            opcode,
            payload,
        } => {
            if let Some(message) = assemble(client, fin, opcode, payload)? {
                dispatch_message(client, drive, &message)?;
            }
            Ok(true)
        }
    }
}

fn assemble(
    client: &mut Client,
    fin: bool,
    opcode: u8,
    payload: Vec<u8>,
) -> io::Result<Option<Vec<u8>>> {
    if opcode == 0 && !client.collecting {
        return Err(io::Error::other("unexpected continuation"));
    }
    if opcode != 0 && client.collecting {
        return Err(io::Error::other("fragment already open"));
    }
    if opcode != 0 {
        client.collecting = true;
    }
    let next = client
        .pending
        .len()
        .checked_add(payload.len())
        .ok_or_else(|| io::Error::other("message length"))?;
    if next > MAX_MESSAGE {
        return Err(io::Error::other("message too large"));
    }
    client.pending.extend(payload);
    if !fin {
        return Ok(None);
    }
    client.collecting = false;
    Ok(Some(std::mem::take(&mut client.pending)))
}

fn dispatch_message(client: &mut Client, drive: &mut Drive, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() {
        return Ok(());
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))?;
    let message = serde_json::from_str(text).map_err(io::Error::other)?;
    write_messages(&mut client.stream, &dispatch::dispatch(drive, &message))
}

fn write_messages(stream: &mut TcpStream, messages: &[Value]) -> io::Result<()> {
    for message in messages {
        let payload = serde_json::to_vec(message).map_err(io::Error::other)?;
        stream.write_all(&ws::encode(1, &payload))?;
    }
    stream.flush()
}

fn idle(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
    )
}
