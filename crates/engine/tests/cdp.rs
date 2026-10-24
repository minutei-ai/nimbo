//! One session keeps a cookie, and unmodified Playwright drives the page.

use std::{
    io::{self, BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

use nimbo_engine::{Limits, Session};
use serde_json::Value;
use tiny_http::{Header, Request, Response, Server};

const SET: &str = "<!doctype html><title>set</title>";
const READ: &str = "<!doctype html><title>read</title>";
const PAGE: &str = "<!doctype html><script>window.nimboValue=\"nimbo-live\"</script>";
const SCRIPT: &str = r#"
const fs = require("fs");
function client() {
  try {
    return require("playwright-core");
  } catch (missing) {
    return require("playwright");
  }
}
const { chromium } = client();
const endpoint = process.argv[2];
const pageUrl = process.argv[3];
function out(text) { fs.writeSync(1, text); }
(async () => {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 20000 });
  const context = browser.contexts()[0];
  if (!context) throw new Error("missing browser context");
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  await page.goto(pageUrl, { timeout: 15000 });
  const value = await page.evaluate(() => window.nimboValue);
  const cookie = await page.evaluate(() => document.cookie);
  out(`VALUE ${JSON.stringify({ value, cookie })}\n`);
  fs.readFileSync(0);
  try {
    await page.evaluate(() => 1);
    out("STILL\n");
  } catch (error) {
    out("CLOSED\n");
  }
})().catch((error) => {
  fs.writeSync(2, `${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
"#;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn node_path() -> String {
    let mut paths = Vec::new();
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest.parent().and_then(|engine| engine.parent()) {
        paths.push(root.join("node_modules").display().to_string());
    }
    paths.push("/usr/lib/node_modules".to_owned());
    if let Ok(existing) = std::env::var("NODE_PATH")
        && !existing.is_empty()
    {
        paths.push(existing);
    }
    paths.join(":")
}

struct Seen {
    value: String,
    cookie: String,
}

struct Playwright {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<String>,
    stdout_thread: Option<thread::JoinHandle<()>>,
    stderr_thread: Option<thread::JoinHandle<()>>,
    stderr_text: Arc<Mutex<String>>,
    script: PathBuf,
}

#[test]
fn session_keeps_a_cookie_and_playwright_reads_the_page() -> TestResult {
    let server = Server::http("127.0.0.1:0").map_err(io::Error::other)?;
    let origin = format!("http://{}", server.server_addr());
    let stop = Arc::new(AtomicBool::new(false));
    let server_stop = Arc::clone(&stop);
    let worker = thread::spawn(move || serve(&server, &server_stop));
    let result = exercise(&origin);
    stop.store(true, Ordering::Relaxed);
    let joined = match worker.join() {
        Ok(result) => result,
        Err(_panic) => Err(io::Error::other("fixture server panicked")),
    };
    result.and(joined.map_err(Into::into))
}

fn exercise(origin: &str) -> TestResult {
    let limits = Limits {
        timeout: Duration::from_secs(30),
        ..Limits::default()
    };
    let session = Session::open(origin, limits)?;
    session.navigate(&format!("{origin}/set"))?;
    session.navigate(&format!("{origin}/read"))?;
    assert_eq!(
        session.evaluate("document.cookie")?,
        Value::String("kept=yes".to_owned())
    );
    drive(&session, &format!("{origin}/value"))
}

fn drive(session: &Session, url: &str) -> TestResult {
    let mut client = Playwright::spawn(session.endpoint(), url)?;
    let outcome = client.read_value().and_then(|seen| {
        session.close();
        client.read_closed().map(|()| seen)
    });
    let stderr = client.shutdown();
    match outcome {
        Ok(seen) => {
            assert_eq!(seen.value, "nimbo-live");
            assert_eq!(seen.cookie, "kept=yes");
            Ok(())
        }
        Err(error) => Err(format!("{error}\n{stderr}").into()),
    }
}

impl Playwright {
    fn spawn(endpoint: &str, url: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let script = std::env::temp_dir().join(format!("nimbo-cdp-{}.js", std::process::id()));
        std::fs::write(&script, SCRIPT)?;
        let mut child = match Command::new("node")
            .env("NODE_PATH", node_path())
            .arg(&script)
            .arg(endpoint)
            .arg(url)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                remove_script(&script);
                return Err(error.into());
            }
        };
        let Some(stdin) = child.stdin.take() else {
            abandon(child, &script);
            return Err("missing stdin".into());
        };
        let Some(stdout) = child.stdout.take() else {
            abandon(child, &script);
            return Err("missing stdout".into());
        };
        let Some(stderr) = child.stderr.take() else {
            abandon(child, &script);
            return Err("missing stderr".into());
        };
        let (sender, lines) = mpsc::channel();
        let stdout_thread = thread::spawn(move || read_stdout(stdout, &sender));
        let stderr_text = Arc::new(Mutex::new(String::new()));
        let slot = Arc::clone(&stderr_text);
        let stderr_thread = thread::spawn(move || read_stderr(stderr, &slot));
        Ok(Self {
            child: Some(child),
            stdin: Some(stdin),
            lines,
            stdout_thread: Some(stdout_thread),
            stderr_thread: Some(stderr_thread),
            stderr_text,
            script,
        })
    }

    fn read_value(&self) -> Result<Seen, Box<dyn std::error::Error>> {
        parse_value(&self.wait_line()?)
    }

    fn read_closed(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.release_stdin()?;
        let line = self.wait_line()?;
        if line == "CLOSED" {
            Ok(())
        } else {
            Err(format!("expected CLOSED, got {line}").into())
        }
    }

    fn release_stdin(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let Some(mut stdin) = self.stdin.take() else {
            return Err("missing stdin".into());
        };
        stdin.write_all(b"again\n")?;
        Ok(())
    }

    fn wait_line(&self) -> Result<String, Box<dyn std::error::Error>> {
        match self.lines.recv_timeout(Duration::from_secs(25)) {
            Ok(line) => Ok(line),
            Err(mpsc::RecvTimeoutError::Timeout) => Err("playwright timed out".into()),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("playwright closed its output".into()),
        }
    }

    fn shutdown(&mut self) -> String {
        if let Some(mut child) = self.child.take() {
            reap(&mut child);
        }
        join_thread(&mut self.stdout_thread);
        join_thread(&mut self.stderr_thread);
        remove_script(&self.script);
        match self.stderr_text.lock() {
            Ok(guard) => guard.clone(),
            Err(_poisoned) => String::new(),
        }
    }
}

impl Drop for Playwright {
    fn drop(&mut self) {
        drop(self.shutdown());
    }
}

fn parse_value(line: &str) -> Result<Seen, Box<dyn std::error::Error>> {
    let payload = line
        .strip_prefix("VALUE ")
        .ok_or("missing playwright value")?;
    let parsed: Value = serde_json::from_str(payload)?;
    let value = parsed
        .get("value")
        .and_then(Value::as_str)
        .ok_or("missing value")?;
    let cookie = parsed
        .get("cookie")
        .and_then(Value::as_str)
        .ok_or("missing cookie")?;
    Ok(Seen {
        value: value.to_owned(),
        cookie: cookie.to_owned(),
    })
}

fn read_stdout(stdout: ChildStdout, sender: &mpsc::Sender<String>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(text) = line else {
            break;
        };
        if sender.send(text).is_err() {
            break;
        }
    }
}

fn read_stderr(stderr: ChildStderr, slot: &Mutex<String>) {
    let mut reader = BufReader::new(stderr);
    let mut text = String::new();
    if reader.read_to_string(&mut text).is_err() {
        return;
    }
    let Ok(mut guard) = slot.lock() else {
        return;
    };
    guard.push_str(&text);
}

fn reap(child: &mut Child) {
    let exited = match child.try_wait() {
        Ok(status) => status.is_some(),
        Err(_error) => true,
    };
    if exited {
        return;
    }
    match child.kill() {
        Ok(()) => {}
        Err(_error) => {}
    }
    match child.wait() {
        Ok(_status) => {}
        Err(_error) => {}
    }
}

fn join_thread(slot: &mut Option<thread::JoinHandle<()>>) {
    let Some(handle) = slot.take() else {
        return;
    };
    match handle.join() {
        Ok(()) => {}
        Err(_panic) => {}
    }
}

fn abandon(mut child: Child, script: &PathBuf) {
    reap(&mut child);
    remove_script(script);
}

fn remove_script(script: &PathBuf) {
    match std::fs::remove_file(script) {
        Ok(()) => {}
        Err(_error) => {}
    }
}

fn serve(server: &Server, stop: &AtomicBool) -> io::Result<()> {
    while !stop.load(Ordering::Relaxed) {
        if let Some(request) = server.recv_timeout(Duration::from_millis(10))? {
            route(request)?;
        }
    }
    Ok(())
}

fn route(request: Request) -> io::Result<()> {
    let url = request.url().to_owned();
    match url.as_str() {
        "/set" => respond(request, SET, Some("kept=yes; Path=/")),
        "/read" => respond(request, READ, None),
        "/value" => respond(request, PAGE, None),
        _ => Err(io::Error::other(format!(
            "unexpected fixture request {url}"
        ))),
    }
}

fn respond(request: Request, body: &str, cookie: Option<&str>) -> io::Result<()> {
    let kind = Header::from_bytes("Content-Type", "text/html")
        .map_err(|()| io::Error::other("invalid fixture header"))?;
    let mut response = Response::from_string(body).with_header(kind);
    if let Some(cookie) = cookie {
        let header = Header::from_bytes("Set-Cookie", cookie)
            .map_err(|()| io::Error::other("invalid cookie header"))?;
        response = response.with_header(header);
    }
    request.respond(response)
}
