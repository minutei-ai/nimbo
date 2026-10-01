//! Browser integration tests against isolated local HTTP fixtures.

use std::{
    io,
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use nimbo_engine::{Browser, Error, Limits};
use serde_json::json;
use tiny_http::{Header, Request, Response, Server};

type TestResult = Result<(), Box<dyn std::error::Error>>;

struct Fixture {
    url: String,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Fixture {
    fn new() -> io::Result<Self> {
        let server = Server::http("127.0.0.1:0").map_err(io::Error::other)?;
        let address = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| io::Error::other("missing listener address"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let thread = thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                match server.recv_timeout(Duration::from_millis(10)) {
                    Ok(Some(request)) => {
                        if serve(request).is_err() {
                            break;
                        }
                    }
                    Ok(None) => (),
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            url: format!("http://{address}"),
            stop,
            thread: Some(thread),
        })
    }

    fn path(&self, path: &str) -> String {
        format!("{}{path}", self.url)
    }
    fn browser(&self) -> nimbo_engine::Result<Browser> {
        Browser::new(&self.url, Limits::default())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            #[expect(
                clippy::expect_used,
                reason = "A server thread panic must fail the test during fixture cleanup"
            )]
            thread.join().expect("fixture server thread must not panic");
        }
    }
}

fn header(name: &str, value: &str) -> io::Result<Header> {
    Header::from_bytes(name, value).map_err(|()| io::Error::other("invalid fixture header"))
}

fn serve(mut request: Request) -> io::Result<()> {
    let mut content_type = "text/html; charset=utf-8";
    let mut status = 200;
    let mut headers = Vec::new();
    let body = match request.url() {
        "/static" => include_str!("fixtures/static.html").to_owned(),
        "/dynamic" => include_str!("fixtures/dynamic.html").to_owned(),
        "/assets/app.js" => {
            content_type = "text/javascript";
            include_str!("fixtures/external-script.txt").to_owned()
        }
        "/api" => {
            content_type = "application/json";
            r#"{"value":"Carregado"}"#.into()
        }
        "/post" => {
            content_type = "text/plain";
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body)?;
            format!("{}:{body}", request.method())
        }
        "/redirect" | "/redirect-loop" | "/redirect-cross" => {
            status = 302;
            let target = match request.url() {
                "/redirect" => "/static",
                "/redirect-loop" => "/redirect-loop",
                _ => "http://localhost:9/blocked",
            };
            headers.push(header("Location", target)?);
            String::new()
        }
        "/cookie-set" => {
            headers.push(header(
                "Set-Cookie",
                "sid=alpha; Path=/; HttpOnly; SameSite=Lax",
            )?);
            "<main>Set</main>".into()
        }
        "/cookie" => {
            let cookie = request
                .headers()
                .iter()
                .find(|header| header.field.equiv("Cookie"))
                .map_or("", |header| header.value.as_str());
            format!("<main>{cookie}</main>")
        }
        "/infinite" => "<script>while (true) {}</script>".into(),
        "/bad-js" => "<script>const = ;</script>".into(),
        "/rejected" => "<script>Promise.reject(new Error('failed'));</script>".into(),
        "/caught" => {
            "<script>Promise.reject(new Error('expected')).catch(() => {});</script><main>ok</main>"
                .into()
        }
        "/cross-script" => "<script src='http://localhost:9/blocked'></script>".into(),
        "/cross-fetch" => "<script>fetch('http://localhost:9/blocked');</script>".into(),
        "/module" => "<script type='module'>export {};</script>".into(),
        "/async" => "<script async src='/assets/app.js'></script>".into(),
        "/iframe" => "<iframe src='/static'></iframe>".into(),
        "/base" => "<base href='/other/'><script src='app.js'></script>".into(),
        "/slow" => {
            thread::sleep(Duration::from_millis(200));
            "<main>Slow</main>".into()
        }
        "/big" => format!("<main>{}</main>", "x".repeat(4096)),
        _ => {
            status = 404;
            "<main>Not found</main>".into()
        }
    };
    let mut response = Response::from_string(body)
        .with_status_code(status)
        .with_header(header("Content-Type", content_type)?);
    for header in headers {
        response.add_header(header);
    }
    request.respond(response)
}

#[test]
fn static_html_entities_and_css_selectors() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("({ title: document.title, heading: document.querySelector('main > h1').textContent, items: Array.from(document.querySelectorAll('li[data-id]'), node => node.textContent), missing: document.querySelector('.missing') })")?,
        json!({"title":"Página estática", "heading":"Nimbo & dados", "items":["Um","Dois"], "missing":null}));
    Ok(())
}

#[test]
fn javascript_scripts_mutations_lifecycle_and_fetch() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/dynamic"))?;
    assert_eq!(page.evaluate("({ title: document.title, text: document.getElementById('result').textContent, created: document.querySelector('#created.output > b[data-kind=value]').textContent, order, identity: document.getElementById('result') === document.querySelector('#result') })")?,
        json!({"title":"Depois", "text":"Carregado", "created":"Criado", "order":["inline","external","after","interactive","complete"], "identity":true}));
    assert_eq!(
        page.evaluate(
            "fetch('/post', {method: 'POST', body: 'payload'}).then(response => response.text())"
        )?,
        json!("POST:payload")
    );
    Ok(())
}

#[test]
fn redirects_preserve_final_url() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/redirect"))?;
    assert_eq!(page.url(), fixture.path("/static"));
    assert_eq!(
        page.evaluate("location.href")?,
        json!(fixture.path("/static"))
    );
    Ok(())
}

#[test]
fn cookies_persist_only_in_their_session() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    drop(browser.navigate(&fixture.path("/cookie-set"))?);
    let page = browser.navigate(&fixture.path("/cookie"))?;
    assert_eq!(
        page.evaluate("document.querySelector('main').textContent")?,
        json!("sid=alpha")
    );
    assert_eq!(
        page.evaluate("fetch('/cookie').then(response => response.text())")?,
        json!("<main>sid=alpha</main>")
    );
    let isolated = fixture.browser()?.navigate(&fixture.path("/cookie"))?;
    assert_eq!(
        isolated.evaluate("document.querySelector('main').textContent")?,
        json!("")
    );
    Ok(())
}

#[test]
fn globals_and_dom_are_fresh_on_every_navigation() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let first = browser.navigate(&fixture.path("/static"))?;
    first.evaluate("(globalThis.secret = 123, document.title = 'changed')")?;
    let second = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(
        second.evaluate(
            "({ secret: typeof secret, title: document.title, host: typeof nimboDom })"
        )?,
        json!({"secret":"undefined", "title":"Página estática", "host":"undefined"})
    );
    assert_eq!(first.evaluate("secret")?, json!(123));
    Ok(())
}

#[test]
fn rejects_cross_origin_navigation_scripts_redirects_and_fetch() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for path in ["/redirect-cross", "/cross-script"] {
        assert!(matches!(
            browser.navigate(&fixture.path(path)),
            Err(Error::Origin(_))
        ));
    }
    assert!(matches!(
        browser.navigate("http://localhost:9/blocked"),
        Err(Error::Origin(_))
    ));
    assert!(matches!(
        browser.navigate(&fixture.path("/cross-fetch")),
        Err(Error::JavaScript(_))
    ));
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        page.evaluate("fetch('http://localhost:9/blocked')")
            .is_err()
    );
    Ok(())
}

#[test]
fn invalid_urls_http_errors_scripts_and_promises_fail_explicitly() -> TestResult {
    for url in [
        "file:///etc/passwd",
        "ftp://example.com",
        "http://user:pass@example.com",
        "not a URL",
    ] {
        assert!(Browser::new(url, Limits::default()).is_err());
    }
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    assert!(matches!(
        browser.navigate(&fixture.path("/missing")),
        Err(Error::HttpStatus(404))
    ));
    for path in ["/module", "/async", "/iframe", "/base"] {
        assert!(matches!(
            browser.navigate(&fixture.path(path)),
            Err(Error::Unsupported(_))
        ));
    }
    for path in ["/bad-js", "/rejected"] {
        assert!(matches!(
            browser.navigate(&fixture.path(path)),
            Err(Error::JavaScript(_))
        ));
    }
    drop(browser.navigate(&fixture.path("/caught"))?);
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(page.evaluate("new Promise(() => {})").is_err());
    assert!(page.evaluate("document.querySelector('[')").is_err());
    assert!(
        page.evaluate("document.body.appendChild(document.documentElement)")
            .is_err()
    );
    Ok(())
}

#[test]
fn response_requests_dom_writes_and_js_memory_are_bounded() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_response_bytes: 512,
            ..Limits::default()
        },
    )?;
    assert!(matches!(
        browser.navigate(&fixture.path("/big")),
        Err(Error::Limit(_))
    ));
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_requests: 1,
            ..Limits::default()
        },
    )?;
    assert!(matches!(
        browser.navigate(&fixture.path("/dynamic")),
        Err(Error::Limit(_))
    ));
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 8,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        page.evaluate("document.body.textContent = 'x'.repeat(100)")
            .is_err()
    );
    let browser = Browser::new(
        &fixture.url,
        Limits {
            javascript_memory_bytes: 2 * 1024 * 1024,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        page.evaluate("Array.from({length: 1000000}, (_, i) => ({i}))")
            .is_err()
    );
    Ok(())
}

#[test]
fn interrupts_infinite_js_and_slow_transport() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            timeout: Duration::from_millis(100),
            ..Limits::default()
        },
    )?;
    let started = Instant::now();
    assert!(browser.navigate(&fixture.path("/infinite")).is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(browser.navigate(&fixture.path("/slow")).is_err());
    Ok(())
}

#[test]
fn redirect_loop_and_microtask_loop_are_bounded() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    assert!(matches!(
        browser.navigate(&fixture.path("/redirect-loop")),
        Err(Error::Limit(_))
    ));
    let browser = Browser::new(
        &fixture.url,
        Limits {
            timeout: Duration::from_millis(100),
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let started = Instant::now();
    assert!(
        page.evaluate("(function repeat() { Promise.resolve().then(repeat); })()")
            .is_err()
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    Ok(())
}

#[test]
fn cli_returns_json_and_nonzero_on_failure() -> TestResult {
    let fixture = Fixture::new()?;
    let output = Command::new(env!("CARGO_BIN_EXE_nimbo-engine"))
        .args([
            fixture.path("/static"),
            "document.querySelector('h1').textContent".into(),
        ])
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&output.stdout)?,
        json!("Nimbo & dados")
    );
    let output = Command::new(env!("CARGO_BIN_EXE_nimbo-engine"))
        .arg(fixture.path("/missing"))
        .output()?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    Ok(())
}

#[test]
fn scoped_queries_mutation_and_removal_use_the_live_dom() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(() => { const main = document.getElementById('content'); const list = main.querySelector('ul'); list.innerHTML = '<li class=added>Três</li>'; const item = main.querySelector('.added'); item.setAttribute('data-id', 3); const before = item.outerHTML; item.remove(); return { before, count: document.querySelectorAll('li').length, escaped: (main.textContent = '<b>literal</b>', main.innerHTML) }; })()")?,
        json!({"before":"<li class=\"added\" data-id=\"3\">Três</li>", "count":0, "escaped":"&lt;b&gt;literal&lt;/b&gt;"}));
    Ok(())
}

#[test]
fn repeated_failure_cleanup_and_session_cycles_remain_usable() -> TestResult {
    let fixture = Fixture::new()?;
    for _ in 0..20 {
        let browser = fixture.browser()?;
        for path in ["/cross-script", "/bad-js", "/rejected"] {
            assert!(browser.navigate(&fixture.path(path)).is_err());
        }
        let page = browser.navigate(&fixture.path("/dynamic"))?;
        assert_eq!(
            page.evaluate("document.getElementById('result').textContent")?,
            json!("Carregado")
        );
    }
    Ok(())
}

#[test]
fn dom_operation_budget_and_expired_page_are_enforced() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_operations: 4,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        page.evaluate("Array.from({length: 20}, () => document.querySelector('li'))")
            .is_err()
    );
    let browser = Browser::new(
        &fixture.url,
        Limits {
            timeout: Duration::from_millis(200),
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    thread::sleep(Duration::from_millis(210));
    assert!(matches!(page.evaluate("42"), Err(Error::Limit(_))));
    Ok(())
}

#[test]
fn cached_selectors_observe_order_scope_and_mutations() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(() => { document.body.innerHTML = '<section class=entry><i class=entry>first</i><i class=entry>second</i></section><i class=entry>outside</i>'; const scope = document.querySelector('section'); const first = scope.querySelector('.entry'); const before = first.textContent; first.remove(); const after = scope.querySelector('.entry').textContent; scope.innerHTML = ''; return { before, after, missing: scope.querySelector('.entry'), remaining: document.querySelectorAll('.entry').length, root: scope.querySelector('section') }; })()")?,
        json!({"before":"first", "after":"second", "missing":null, "remaining":2, "root":null}));
    Ok(())
}
