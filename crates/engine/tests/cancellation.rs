//! Native cancellation against real, deliberately incomplete HTTP responses.

use nimbo_engine::{Browser, CancellationToken, Error, Limits};
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn request_headers(stream: &mut TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    for _ in 0..64 {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Err(io::Error::other("request closed before headers"));
        }
        if line == "\r\n" {
            return Ok(());
        }
    }
    Err(io::Error::other("fixture request header limit"))
}

#[test]
fn cancellation_drops_pending_http_and_partial_body_and_recovers() -> TestResult {
    for partial in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let origin = format!("http://{}/", listener.local_addr()?);
        let (entered, received) = mpsc::channel();
        let server = thread::spawn(move || -> io::Result<()> {
            for attempt in 0..2 {
                let deadline = Instant::now()
                    .checked_add(Duration::from_secs(3))
                    .ok_or_else(|| io::Error::other("fixture deadline overflow"))?;
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(1));
                        }
                        Err(error) => return Err(error),
                    }
                };
                request_headers(&mut stream)?;
                if attempt == 0 {
                    if partial {
                        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1000000\r\n\r\n<title>partial</title>")?;
                    }
                    entered.send(()).map_err(io::Error::other)?;
                    let mut byte = [0_u8; 1];
                    if stream.read(&mut byte)? != 0 {
                        return Err(io::Error::other(
                            "cancelled request did not close its socket",
                        ));
                    }
                } else {
                    let body = "<title>fresh</title>";
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )?;
                }
            }
            Ok(())
        });
        let browser = Browser::new(&origin, Limits::default())?;
        let token = CancellationToken::new();
        let stop = token.clone();
        let cancelling = thread::spawn(move || -> Result<(), mpsc::RecvTimeoutError> {
            received.recv_timeout(Duration::from_secs(2))?;
            thread::sleep(Duration::from_millis(25));
            stop.cancel();
            Ok(())
        });
        let started = Instant::now();
        let result = browser.navigate_with_cancel(&origin, &token);
        cancelling
            .join()
            .map_err(|_panic| "cancelling thread panicked")??;
        assert!(
            matches!(result, Err(Error::Cancelled)),
            "partial={partial}: {result:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        let recovered = browser.navigate(&origin)?;
        assert_eq!(
            recovered.evaluate("document.title")?,
            serde_json::json!("fresh")
        );
        server
            .join()
            .map_err(|_panic| "HTTP fixture thread panicked")??;
    }
    Ok(())
}
