//! Native proxy integration with real forwarding sockets and isolated TLS origins.

use nimbo_engine::{Browser, CancellationToken, Error, Limits};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

fn fixture() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tooling/native-proxy-fixture.py")
}

#[test]
fn native_cli_proxy_covers_navigation_and_javascript_subrequests()
-> Result<(), Box<dyn std::error::Error>> {
    let output = Command::new("python3")
        .arg(fixture())
        .arg(env!("CARGO_BIN_EXE_nimbo-engine"))
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(
        report.get("origin_requests"),
        Some(&serde_json::json!(1064))
    );
    Ok(())
}

#[test]
fn cancellation_through_authenticated_proxy_releases_stalled_response_and_recovers()
-> Result<(), Box<dyn std::error::Error>> {
    let mut server = Command::new("python3")
        .args(["-u".as_ref(), fixture().as_os_str(), "--serve".as_ref()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    let mut line = String::new();
    BufReader::new(server.stdout.take().ok_or("fixture stdout")?).read_line(&mut line)?;
    let config: serde_json::Value = serde_json::from_str(&line)?;
    let proxy = config
        .get("proxies")
        .and_then(serde_json::Value::as_array)
        .and_then(|proxies| {
            proxies
                .iter()
                .find(|entry| entry.get("mode") == Some(&serde_json::json!("http-auth")))
        })
        .and_then(|entry| entry.get("url"))
        .and_then(serde_json::Value::as_str)
        .ok_or("authenticated proxy")?;
    let port = config
        .get("http_port")
        .and_then(serde_json::Value::as_u64)
        .ok_or("origin port")?;
    let origin = format!("http://example.test:{port}/");
    let browser = Browser::with_proxy(&origin, Limits::default(), proxy)?;
    let token = CancellationToken::new();
    let stop = token.clone();
    let cancelling = thread::spawn(move || {
        thread::sleep(Duration::from_millis(300));
        stop.cancel();
    });
    let started = Instant::now();
    let result = browser.navigate_with_cancel(&format!("{origin}stall"), &token);
    cancelling
        .join()
        .map_err(|_panic| "cancelling thread panicked")?;
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(2));
    let recovered = browser.navigate(&format!("{origin}start"))?;
    assert_eq!(
        recovered.evaluate("document.cookie")?,
        serde_json::json!("transport=retained")
    );
    let mut input = server.stdin.take().ok_or("fixture stdin")?;
    writeln!(input, "stop")?;
    drop(input);
    server.wait()?;
    Ok(())
}
