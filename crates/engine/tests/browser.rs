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

use nimbo_engine::{Browser, Error, Limits, MediaEnvironment};
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

fn script_fixture(script: &str) -> String {
    format!("<script>{script}</script>")
}

fn layout_fixture(path: &str) -> String {
    let script = match path {
        "/empty-layout" => return "<!doctype html><body></body>".into(),
        "/registrations" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/registrations.txt"))
            );
        }
        "/font-queries" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/font-queries.txt"))
            );
        }
        "/containers" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/containers.txt"))
            );
        }
        "/cascade-index" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/cascade-index.txt"))
            );
        }
        "/animations" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/animations.txt"))
            );
        }
        "/selector-ast" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/selector-ast.txt"))
            );
        }
        "/generated-boxes" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/generated-boxes.txt"))
            );
        }
        "/document-host" => {
            return format!(
                "<!doctype html><body>{}",
                script_fixture(include_str!("fixtures/document-host.txt"))
            );
        }
        "/group-errors" => include_str!("fixtures/group-errors.txt"),
        "/dataset" => include_str!("fixtures/dataset.txt"),
        "/supports" => include_str!("fixtures/supports.txt"),
        "/layers" => include_str!("fixtures/layers.txt"),
        "/external-styles" => {
            return format!(
                "<!doctype html><html><head><link id=\"initial\" rel=\"stylesheet\" href=\"/sheets-css/main?v=0\"></head><body><script>{}</script></body></html>",
                include_str!("fixtures/external-styles.txt")
            );
        }
        "/cascade" => include_str!("fixtures/cascade.txt"),
        "/variables" => include_str!("fixtures/variables.txt"),
        "/intersections" => include_str!("fixtures/intersections.txt"),
        "/geometry" => include_str!("fixtures/geometry.txt"),
        _ => {
            return format!(
                "<!doctype html>{}",
                script_fixture(include_str!("fixtures/node-insertion.txt"))
            );
        }
    };
    script_fixture(script)
}

fn serve_sheet(request: Request) -> io::Result<()> {
    let path = request.url().split('?').next().unwrap_or_default();
    let name = path.rsplit('/').next().unwrap_or_default();
    let (body, status, mime) = match name {
        "main" => ("#target{width:40px;height:30px}", 200, "text/css"),
        "later" => ("#target{width:70px;height:30px}", 200, "text/css"),
        "important" => (
            "#target{width:80px !important;height:30px}",
            200,
            "text/css",
        ),
        "variables" => (
            "body{--external:90px}#target{width:var(--external)}",
            200,
            "text/css",
        ),
        "final" => ("#target{width:60px;height:30px}", 200, "text/css"),
        "charset" => (
            "#target{width:55px;height:30px}",
            200,
            "TEXT/CSS; charset=utf-8",
        ),
        "wrong-mime" => ("#target{width:500px}", 200, "text/plain"),
        "redirect" => ("", 302, "text/css"),
        _ => ("missing", 404, "text/css"),
    };
    let mut response = Response::from_string(body)
        .with_status_code(status)
        .with_header(
            Header::from_bytes("Content-Type", mime)
                .map_err(|()| io::Error::other("invalid header"))?,
        );
    if status == 302 {
        response.add_header(
            Header::from_bytes("Location", "/sheets-css/final")
                .map_err(|()| io::Error::other("invalid header"))?,
        );
    }
    request.respond(response)
}

fn is_cookie_resource(path: &str) -> bool {
    path.starts_with("/cookies/") || matches!(path, "/outside/echo" | "/cookies-other/echo")
}

fn serve_cookies(request: Request) -> io::Result<()> {
    let mut headers = Vec::new();
    let body = if request.url().starts_with("/cookies/") && request.url() != "/cookies/echo" {
        headers.push(header("Set-Cookie", "sid=alpha; HttpOnly; Path=/")?);
        headers.push(header("Set-Cookie", "boot=visible; Path=/")?);
        script_fixture(include_str!("fixtures/cookies.txt"))
    } else {
        headers.push(header("Set-Cookie", "fetched=yes; Path=/")?);
        let cookies = request
            .headers()
            .iter()
            .find(|header| header.field.equiv("Cookie"))
            .map_or("", |header| header.value.as_str());
        serde_json::to_string(cookies).map_err(io::Error::other)?
    };
    respond(request, body, 200, "text/html; charset=utf-8", headers)
}

fn serve(mut request: Request) -> io::Result<()> {
    if is_resource(request.url()) {
        return serve_resource(request);
    }

    let mut content_type = "text/html; charset=utf-8";
    let mut status = 200;
    let mut headers = Vec::new();
    let body = match request.url() {
        "/cascade" | "/variables" | "/node-insertion" | "/intersections" | "/geometry" | "/external-styles" | "/layers" | "/supports" | "/dataset" | "/group-errors" | "/document-host" | "/generated-boxes" | "/selector-ast" | "/animations" | "/cascade-index" | "/containers" | "/empty-layout" | "/font-queries" | "/registrations" => layout_fixture(request.url()),
        "/style-variables" => script_fixture(include_str!("fixtures/style-variables.txt")),
        "/styles" => script_fixture(include_str!("fixtures/styles.txt")),
        "/anchors" => format!("<base href=\"https://example.com/root/\"><a id=\"link\" href=\"../doc?q=1#fragment\">link</a><svg><a></a></svg><script>{}</script>", include_str!("fixtures/anchors.txt")),
        "/encoding" => format!("<script>{}</script>", include_str!("fixtures/encoding.txt")),
        "/custom-elements" => format!("<x-root></x-root><x-parsed data-native=\"source\"></x-parsed><script>{}</script>", include_str!("fixtures/custom-elements.txt")),
        "/html-elements" => format!("<main></main><svg><linearGradient></linearGradient><foreignObject><div></div></foreignObject></svg><math><mi>x</mi></math><script>{}</script>", include_str!("fixtures/html-elements.txt")),
        "/tokens" => format!("<title>Tokens</title><script>{}</script>", include_str!("fixtures/tokens.txt")),
        "/media" => format!("<title>Media</title><script>{}</script>", include_str!("fixtures/media.txt")),
        "/storage" => format!("<title>Storage</title><script>{}</script>", include_str!("fixtures/storage.txt")),
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
        "/module-main" => "<script>globalThis.moduleLoads = 0;</script><script type='module' src='/modules/root.js'></script><script type='module' src='/modules/root.js'></script>".into(),
        "/modules/root.js" => {
            content_type = "text/javascript";
            "import value, {bump,count} from './shared.js'; import {again} from './reexport.js'; globalThis.moduleReady = new Promise(resolve => setTimeout(resolve, 12)); await moduleReady; bump(); globalThis.moduleLoads++; globalThis.moduleResult = {value:value.n,identity:value === again,count,meta:import.meta.url.endsWith('/modules/root.js')};".into()
        }
        "/modules/shared.js" => {
            content_type = "text/javascript";
            "export let count = 0; export function bump() {count++;} export default {n:42};".into()
        }
        "/modules/reexport.js" => {
            content_type = "text/javascript";
            "export {default as again} from './shared.js';".into()
        }
        "/async" => "<script async src='/assets/app.js'></script>".into(),
        "/iframe" => "<iframe src='/static'></iframe>".into(),
        "/base" => "<base href='/other/'><script src='app.js'></script>".into(),
        "/other/app.js" => "globalThis.baseClassic = true".into(),
        "/base-module" => "<base href='/other/'><script type='module'>import {value} from './base-module.js'; globalThis.baseModule=value;</script>".into(),
        "/other/base-module.js" => { content_type = "text/javascript"; "export const value='base module'".into() },
        "/base-fetch" => "<base href='/other/'><script>globalThis.baseFetch=fetch('data').then(response=>response.text())</script>".into(),
        "/other/data" => "base response".into(),
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
    respond(request, body, status, content_type, headers)
}

fn respond(
    request: Request,
    body: String,
    status: u16,
    content_type: &str,
    headers: Vec<Header>,
) -> io::Result<()> {
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
    for path in ["/async", "/iframe"] {
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
fn character_creation_and_mutation_share_the_native_write_budget() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 8,
            ..Limits::default()
        },
    )?;
    for expression in [
        "document.createTextNode('x'.repeat(9))",
        "document.createComment('x'.repeat(9))",
        "document.createElement('x'.repeat(9))",
        "new Text('😀😀😀')",
        "(() => { const text = new Text('1234'); text.data = '56789'; })()",
    ] {
        let page = browser.navigate(&fixture.path("/static"))?;
        assert!(page.evaluate(expression).is_err(), "{expression}");
        assert_eq!(page.evaluate("document.isConnected")?, json!(true));
    }
    let page = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate(
            "(() => { const text = new Text('1234'); text.data = '5678'; return text.data; })()"
        )?,
        json!("5678")
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
    // Link-free navigation no longer spends the callback budget on stylesheet discovery.
    let page = browser.navigate(&fixture.path("/static"))?;
    let error = page
        .evaluate("Array.from({length: 5}, () => document.querySelector('li'))")
        .err()
        .ok_or("DOM reads exceeded the budget without rejection")?;
    assert!(error.to_string().contains("DOM operations"));
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_operations: 64,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        page.evaluate("Array.from({length: 128}, () => document.querySelector('li'))")
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

#[test]
fn ancestry_and_matching_observe_detached_nodes_and_reparenting() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(() => { const main = document.querySelector('main'); const item = document.createElement('i'); item.setAttribute('data-state', 'old'); main.appendChild(item); const before = item.closest('main') === main && item.matches('main > i[data-state=old]'); item.removeAttribute('data-state'); item.removeAttribute('missing'); const removed = !item.hasAttribute('data-state') && !item.matches('[data-state]'); item.remove(); const detached = item.parentElement === null && item.closest('i') === item && item.closest('main') === null; document.body.appendChild(item); return {before, removed, detached, parent: item.parentElement === document.body, reparented: item.matches('body > i'), root: document.documentElement.parentElement, missing: document.body.closest('.missing')}; })()")?,
        json!({"before":true,"removed":true,"detached":true,"parent":true,"reparented":true,"root":null,"missing":null}));
    for expression in ["document.body.matches('[')", "document.body.closest('[')"] {
        assert!(page.evaluate(expression).is_err());
    }
    assert_eq!(page.evaluate("document.body.matches('body')")?, json!(true));
    Ok(())
}

#[test]
fn element_traversal_skips_text_and_comments_and_tracks_connectivity() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(() => { document.body.innerHTML = '<section>before<!--a--><i>first</i>between<!--b--><b>last</b>after</section>'; const section = document.querySelector('section'); const first = section.firstElementChild; const last = section.lastElementChild; const before = {first: first.textContent, last: last.textContent, next: first.nextElementSibling === last, previous: last.previousElementSibling === first, boundaries: first.previousElementSibling === null && last.nextElementSibling === null, contains: document.contains(first) && first.contains(first) && !first.contains(section) && !first.contains(null), connected: first.isConnected && document.isConnected}; section.remove(); return {before, detached: !first.isConnected && section.contains(first) && !document.contains(first), identity: section.firstElementChild === first}; })()")?,
        json!({"before":{"first":"first","last":"last","next":true,"previous":true,"boundaries":true,"contains":true,"connected":true},"detached":true,"identity":true}));
    Ok(())
}

#[test]
fn real_clock_timers_interleave_microtasks_and_clamp_nested_tasks() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let start = Instant::now();
    let result = page.evaluate(r"new Promise(resolve => {
        const order = []; let count = 0;
        queueMicrotask(() => order.push('micro'));
        setTimeout(() => { order.push('first'); queueMicrotask(() => order.push('between')); }, 0);
        setTimeout(() => order.push('second'), 0);
        const canceled = setInterval(() => order.push('canceled'), 0); clearTimeout(canceled);
        const nested = () => { if (++count < 9) setTimeout(nested, 0); else resolve({count,order}); };
        setTimeout(nested, 0);
    })")?;
    assert_eq!(
        result,
        json!({"count":9,"order":["micro","first","between","second"]})
    );
    assert!(start.elapsed() >= Duration::from_millis(10));
    let microtask_start = Instant::now();
    assert_eq!(page.evaluate(r"new Promise(resolve => {
        let count = 0;
        const nested = () => { if (++count < 9) queueMicrotask(() => setTimeout(nested, 0)); else resolve(count); };
        setTimeout(nested, 0);
    })")?, json!(9));
    assert!(microtask_start.elapsed() >= Duration::from_millis(10));
    Ok(())
}

#[test]
fn timer_capacity_task_budget_and_deadline_are_enforced() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_timers: 2,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        matches!(page.evaluate("(() => {setTimeout(() => {}, 100); setInterval(() => {}, 100); setTimeout(() => {}, 100);})()"), Err(Error::JavaScript(message)) if message.contains("timer capacity limit"))
    );
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_timer_tasks: 2,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        matches!(page.evaluate("new Promise(() => setInterval(() => {}, 0))"), Err(Error::JavaScript(message)) if message.contains("timer task limit"))
    );
    let browser = Browser::new(
        &fixture.url,
        Limits {
            timeout: Duration::from_millis(80),
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let start = Instant::now();
    assert!(matches!(
        page.evaluate("new Promise(resolve => setTimeout(resolve, 60000))"),
        Err(Error::Limit("navigation deadline"))
    ));
    assert!(start.elapsed() < Duration::from_secs(1));
    Ok(())
}

#[test]
fn native_module_graphs_cache_roots_and_share_live_exports() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/module-main"))?;
    assert_eq!(
        page.evaluate("moduleReady.then(() => ({loads:moduleLoads,result:moduleResult}))")?,
        json!({"loads":1,"result":{"value":42,"identity":true,"count":1,"meta":true}})
    );
    assert_eq!(
        page.evaluate("import('./modules/shared.js').then(ns => ns.count)")?,
        json!(1)
    );
    assert!(page.evaluate("import('./modules/not-loaded.js')").is_err());
    drop(page);
    assert_eq!(
        browser.navigate(&fixture.path("/module"))?.evaluate("1")?,
        json!(1)
    );
    Ok(())
}

#[test]
fn web_storage_preserves_strings_and_native_navigation_state() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/storage"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing storage object")?;
    assert_eq!(fields.len(), 18);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    let next = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(
        next.evaluate("[localStorage.persist,sessionStorage.persist]")?,
        json!(["Storage", "Storage"])
    );
    assert_eq!(
        next.evaluate(
            "(localStorage.setItem('persist', 'changed'), sessionStorage.clear(), true)"
        )?,
        json!(true)
    );
    assert_eq!(
        page.evaluate("[localStorage.persist,sessionStorage.length]")?,
        json!(["changed", 0])
    );
    let isolated = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(
        isolated.evaluate("[localStorage.length,sessionStorage.length]")?,
        json!([0, 0])
    );
    let other = Fixture::new()?;
    assert!(browser.navigate(&other.path("/static")).is_err());
    Ok(())
}

#[test]
fn web_storage_quota_is_atomic_and_counts_utf16_bytes() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_storage_bytes: 16,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate("(localStorage.setItem('q', '😀😀😀x'), localStorage.q)")?,
        json!("😀😀😀x")
    );
    assert_eq!(page.evaluate(r"(() => {
      const errors = [];
      for (const action of [() => localStorage.setItem('q', '😀😀😀xx'), () => localStorage.setItem('new', 'v')]) {
        try {action(); errors.push(false);} catch(error) {errors.push(error instanceof DOMException && error.name === 'QuotaExceededError');}
      }
      const atomic = localStorage.q === '😀😀😀x' && localStorage.length === 1 && localStorage.new === undefined;
      sessionStorage.setItem('q', '😀😀😀x');
      localStorage.removeItem('q'); localStorage.setItem('q', '😀😀😀x');
      localStorage.setItem('q', ''); localStorage.setItem('r', 'reused');
      return {errors,atomic,independent:sessionStorage.q === '😀😀😀x',reuse:localStorage.r === 'reused'};
    })()")?, json!({"errors":[true,true],"atomic":true,"independent":true,"reuse":true}));
    let failure = page.evaluate("localStorage.setItem('new', 'v')");
    assert!(
        matches!(failure, Err(Error::JavaScript(message)) if message.contains("QuotaExceededError"))
    );
    let primitive = page.evaluate("(() => {throw 'sentinel';})()");
    assert!(matches!(primitive, Err(Error::JavaScript(message)) if message.contains("sentinel")));
    Ok(())
}

#[test]
fn media_queries_use_the_native_configured_environment() -> TestResult {
    let fixture = Fixture::new()?;
    for variant in 0..64 {
        let media = MediaEnvironment {
            width: 800 + variant,
            height: 600 + (variant % 2) * 300,
            color_scheme: if variant % 2 == 0 {
                "dark".into()
            } else {
                "light".into()
            },
            reduced_motion: variant % 3 == 0,
            default_font_size: 16,
        };
        let browser = Browser::with_media(&fixture.url, Limits::default(), media.clone())?;
        let page = browser.navigate(&fixture.path("/media"))?;
        let result = page.evaluate("comparison")?;
        let fields = result.as_object().ok_or("missing media result")?;
        assert_eq!(fields.len(), 20);
        for (name, value) in fields {
            let expected = match name.as_str() {
                "width" => json!(media.width),
                "height" => json!(media.height),
                "dark" => json!(media.color_scheme == "dark"),
                "reduced" => json!(media.reduced_motion),
                _ => json!(true),
            };
            assert_eq!(*value, expected, "variant {variant}: {name}");
        }
    }
    Ok(())
}

#[test]
fn class_lists_are_live_and_mutate_the_native_attribute() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/tokens"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing token result")?;
    assert_eq!(fields.len(), 20);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    let limited = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 8,
            ..Limits::default()
        },
    )?;
    let page = limited.navigate(&fixture.path("/static"))?;
    assert!(
        page.evaluate("document.body.classList.add('x'.repeat(9))")
            .is_err()
    );
    assert_eq!(
        page.evaluate("document.body.hasAttribute('class')")?,
        json!(false)
    );
    let page = limited.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate(
            "(() => { document.body.classList.add('123'); return document.body.className; })()"
        )?,
        json!("123")
    );
    Ok(())
}

#[test]
fn html_elements_use_native_namespaces_and_reflected_attributes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/html-elements"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing HTML element result")?;
    assert_eq!(fields.len(), 12);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn custom_elements_upgrade_native_nodes_and_deliver_reactions() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/custom-elements"))?;
    let result = page.evaluate("comparisonPromise")?;
    let fields = result.as_object().ok_or("missing custom element result")?;
    assert_eq!(fields.len(), 18);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn encoding_handles_native_bytes_unicode_and_streaming_codecs() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/encoding"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing encoding result")?;
    assert_eq!(fields.len(), 14);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn anchors_use_native_urls_reflection_tokens_and_document_base() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/anchors"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing anchor result")?;
    assert_eq!(fields.len(), 20);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn document_base_urls_drive_real_scripts_modules_and_fetch() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    assert_eq!(
        browser
            .navigate(&fixture.path("/base"))?
            .evaluate("baseClassic")?,
        json!(true)
    );
    assert_eq!(
        browser
            .navigate(&fixture.path("/base-module"))?
            .evaluate("baseModule")?,
        json!("base module")
    );
    assert_eq!(
        browser
            .navigate(&fixture.path("/base-fetch"))?
            .evaluate("baseFetch")?,
        json!("base response")
    );
    Ok(())
}

#[test]
fn inline_styles_use_native_declarations_and_live_dom_attributes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/styles"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing styles result")?;
    assert_eq!(fields.len(), 20);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn inline_variables_preserve_native_pending_shorthands_and_invalidations() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/style-variables"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing variable styles result")?;
    assert_eq!(fields.len(), 27);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn native_box_geometry_observes_inline_styles_and_live_dom_changes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/geometry"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing geometry result")?;
    assert_eq!(fields.len(), 17);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn author_stylesheet_cascade_drives_real_native_box_measurements() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/cascade"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing cascade result")?;
    assert_eq!(fields.len(), 24);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn custom_properties_resolve_inheritance_cycles_and_pending_shorthands() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/variables"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing variables result")?;
    assert_eq!(fields.len(), 42);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn intersection_observers_measure_real_boxes_and_deliver_threshold_changes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/intersections"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing intersection result")?;
    assert_eq!(fields.len(), 36);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn node_insertion_converts_strings_and_moves_native_children() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/node-insertion"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing insertion result")?;
    assert_eq!(fields.len(), 30);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn external_stylesheets_load_through_http_and_update_native_cascade() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/external-styles"))?;
    let result = page.evaluate("comparison")?;
    let fields = result
        .as_object()
        .ok_or("missing external stylesheet result")?;
    assert_eq!(fields.len(), 29);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn cascade_layers_preserve_order_priority_and_nesting() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/layers"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing layer result")?;
    assert_eq!(fields.len(), 30);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn supports_conditions_query_usable_native_declarations() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/supports"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing supports result")?;
    assert_eq!(fields.len(), 32);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn dataset_views_read_and_mutate_real_attributes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/dataset"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing dataset result")?;
    assert_eq!(fields.len(), 34);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn nested_stylesheet_failures_preserve_their_cause_and_recover() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/group-errors"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing group failure result")?;
    assert_eq!(fields.len(), 37);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn document_stylesheets_evaluate_host_predicates_without_shadow_context() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/document-host"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing document host result")?;
    assert_eq!(fields.len(), 33);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn generated_before_and_after_boxes_affect_real_geometry_without_dom_children() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/generated-boxes"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing generated box result")?;
    assert_eq!(fields.len(), 105);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}; geometry: {}",
        page.evaluate("generatedGeometry")?
    );
    Ok(())
}

#[test]
fn native_selector_ast_matches_structures_and_excludes_absent_pseudo_elements() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/selector-ast"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing selector result")?;
    assert_eq!(fields.len(), 50);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn paused_css_animations_interpolate_native_box_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/animations"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing animation result")?;
    assert_eq!(fields.len(), 66);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}; geometry: {}",
        page.evaluate("animationGeometry")?
    );
    Ok(())
}

#[test]
fn indexed_stylesheets_match_large_sheets_and_current_element_identity() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/cascade-index"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing cascade index result")?;
    assert_eq!(fields.len(), 55);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn container_queries_use_actual_ancestor_content_box_sizes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/containers"))?;
    let result = page.evaluate("comparison")?;
    assert_eq!(page.evaluate("containerRatioPrecision")?, json!(true));
    let fields = result.as_object().ok_or("missing container result")?;
    assert_eq!(fields.len(), 79);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn container_layout_pass_limit_is_independent_of_the_dom_budget() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_operations: 100_000,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/empty-layout"))?;
    let failure = page.evaluate(include_str!("fixtures/container-budget.txt"))?;
    assert!(
        failure
            .as_str()
            .is_some_and(|message| message.contains("container layout passes")),
        "{failure}"
    );
    assert_eq!(page.evaluate("(()=>{document.querySelector('style').remove();document.body.innerHTML='';const node=document.createElement('div');node.style.width='11px';document.body.appendChild(node);return node.getBoundingClientRect().width;})()")?, json!(11));
    Ok(())
}

#[test]
fn contextual_font_sizes_and_query_lengths_follow_native_cascade() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/font-queries"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing font query result")?;
    assert_eq!(fields.len(), 78);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn configured_initial_font_sizes_control_root_units_and_media_queries() -> TestResult {
    let fixture = Fixture::new()?;
    for initial in 16_u16..80 {
        let width = u32::from(initial)
            .checked_mul(10)
            .ok_or("viewport overflow")?;
        let height = u32::from(initial)
            .checked_mul(8)
            .ok_or("viewport overflow")?;
        let browser = Browser::with_media(
            &fixture.url,
            Limits::default(),
            MediaEnvironment {
                width,
                height,
                default_font_size: initial,
                ..MediaEnvironment::default()
            },
        )?;
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let variant = initial.checked_sub(16).ok_or("variant overflow")?;
        let result = page.evaluate(&format!(
            "(()=>{{globalThis.variant={variant};return {};}})()",
            include_str!("fixtures/font-config.txt")
        ))?;
        assert_eq!(
            result,
            json!({"initialRem":true,"mediaRem":true,"mediaEm":true,"mediaRootIndependent":true,"recovery":true})
        );
    }
    Ok(())
}

#[test]
fn registered_custom_properties_validate_before_substitution() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/registrations"))?;
    let result = page.evaluate("comparison")?;
    let fields = result.as_object().ok_or("missing registration result")?;
    assert_eq!(fields.len(), 74);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

fn is_dom_resource(path: &str) -> bool {
    [
        "/link-guard",
        "/large-dom/",
        "/custom-boxes/",
        "/positioned-boxes/",
        "/sticky-geometry/",
        "/z-index/",
        "/z-index-style",
        "/namespaced-elements/",
        "/urls/",
        "/response-encoding/",
        "/adopted-sheets/",
        "/constructed-sheets/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
}

fn serve_resource(request: Request) -> io::Result<()> {
    if request.url().starts_with("/z-index/") || request.url() == "/z-index-style" {
        return serve_z_index(request);
    }
    if is_cookie_resource(request.url()) {
        return serve_cookies(request);
    }
    if is_dom_resource(request.url()) {
        return serve_dom_resources(request);
    }
    if request.url().starts_with("/html-boxes/") || request.url().starts_with("/html-boxes-assets/")
    {
        return serve_html_boxes(request);
    }
    if request.url().starts_with("/display/") || request.url().starts_with("/display-assets/") {
        return serve_display(request);
    }
    if request.url().starts_with("/font-family/")
        || request.url().starts_with("/font-family-assets/")
    {
        return serve_font_family(request);
    }
    if request.url().starts_with("/background-layers/")
        || request.url().starts_with("/background-layers-assets/")
    {
        return serve_background_layers(request);
    }
    if request.url().starts_with("/background-size/")
        || request.url().starts_with("/background-size-assets/")
    {
        return serve_background_size(request);
    }
    if request.url().starts_with("/background-repeat/")
        || request.url().starts_with("/background-repeat-assets/")
    {
        return serve_background_repeat(request);
    }
    if request.url().starts_with("/background-position/")
        || request.url().starts_with("/background-position-assets/")
    {
        return serve_background_position(request);
    }
    if request.url().starts_with("/background-images/")
        || request.url().starts_with("/background-images-assets/")
    {
        return serve_background_images(request);
    }
    if request.url().starts_with("/line-height/")
        || request.url().starts_with("/line-height-assets/")
    {
        return serve_line_height(request);
    }
    if request.url().starts_with("/tabs/") || request.url().starts_with("/tabs-assets/") {
        return serve_tabs(request);
    }
    if request.url().starts_with("/text-adjust/")
        || request.url().starts_with("/text-adjust-assets/")
    {
        return serve_text_adjust(request);
    }
    if request.url().starts_with("/outlines/") || request.url().starts_with("/outline-assets/") {
        return serve_outlines(request);
    }
    if request.url().starts_with("/logical-size/") {
        let source = format!(
            "<!doctype html><meta charset=utf-8><script>{}</script>",
            include_str!("fixtures/logical-size.txt")
        );
        return request.respond(
            Response::from_string(source).with_header(header("Content-Type", "text/html")?),
        );
    }
    if request.url().starts_with("/layout-budget/") {
        return serve_layout_budget(request);
    }
    if request.url().starts_with("/canvas/") {
        return serve_canvas(request);
    }
    if request.url().starts_with("/borders/") {
        return serve_borders(request);
    }
    if request.url().starts_with("/css-budget/") || request.url().starts_with("/css-budget-assets/")
    {
        return serve_css_budget(request);
    }
    if request.url().starts_with("/font-assets/")
        || request.url().starts_with("/font-loading/")
        || request.url().starts_with("/font-matching/")
    {
        return serve_fonts(request);
    }
    if request.url().starts_with("/binary/") {
        return serve_binary(request);
    }
    serve_sheet(request)
}
fn serve_binary(request: Request) -> io::Result<()> {
    let path = request.url();
    let mut status = 200;
    let mut headers = Vec::new();
    let data = if let Some(variant) = path.strip_prefix("/binary/data/") {
        let variant = variant.parse::<u16>().map_err(io::Error::other)?;
        (0_u16..512)
            .map(|i| u8::try_from(i.saturating_add(variant) % 256).map_err(io::Error::other))
            .collect::<io::Result<Vec<_>>>()?
    } else if let Some(variant) = path.strip_prefix("/binary/redirect/") {
        status = 302;
        headers.push(header("Location", &format!("/binary/data/{variant}"))?);
        Vec::new()
    } else {
        match path {
            "/binary/font.ttf" => include_bytes!("fixtures/synthetic-font.ttf").to_vec(),
            "/binary/bom" => "\u{feff}Olá € 😀".as_bytes().to_vec(),
            "/binary/invalid" => vec![255, 40],
            "/binary/unicode-large" => {
                format!("{}😀{}€", "a".repeat(32767), "b".repeat(32767)).into_bytes()
            }
            "/binary/json" => "\u{feff}{\"value\":\"Olá € 😀\"}".as_bytes().to_vec(),
            "/binary/json-bad" => vec![255],
            "/binary/empty" => Vec::new(),
            "/binary/no-content" => {
                status = 204;
                Vec::new()
            }
            "/binary/large" => vec![255; 2 * 1024 * 1024],
            _ => {
                status = 404;
                vec![255, 0]
            }
        }
    };
    let mut response = Response::from_data(data)
        .with_status_code(status)
        .with_header(header("Content-Type", "application/octet-stream")?);
    for value in headers {
        response.add_header(value);
    }
    request.respond(response)
}

#[test]
fn binary_fetch_preserves_bytes_and_body_consumption() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let result = page.evaluate(&format!(
            "(()=>{{globalThis.variant={variant};return {};}})()",
            include_str!("fixtures/binary-fetch.txt")
        ))?;
        let fields = result.as_object().ok_or("missing binary result")?;
        assert_eq!(fields.len(), 26);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn binary_response_limits_preserve_fresh_navigation() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_response_bytes: 1024,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/empty-layout"))?;
    assert!(matches!(
        page.evaluate("fetch('/binary/font.ttf').then(response=>response.arrayBuffer())"),
        Err(Error::Limit("total response bytes"))
    ));
    let healthy = browser.navigate(&fixture.path("/empty-layout"))?;
    assert_eq!(
        healthy.evaluate(
            "fetch('/binary/data/0').then(response=>response.bytes()).then(bytes=>bytes.length)"
        )?,
        json!(512)
    );
    Ok(())
}

#[test]
fn binary_font_data_parses_real_bytes_and_tracks_status() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let result = page.evaluate(&format!(
            "(()=>{{globalThis.variant={variant};return {};}})()",
            include_str!("fixtures/font-data.txt")
        ))?;
        let fields = result.as_object().ok_or("missing font result")?;
        assert_eq!(fields.len(), 22);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn is_resource(path: &str) -> bool {
    if is_cookie_resource(path) {
        return true;
    }
    is_dom_resource(path)
        || [
            "/sheets-css/",
            "/layout-budget/",
            "/logical-size/",
            "/outlines/",
            "/tabs/",
            "/line-height/",
            "/background-images/",
            "/background-position/",
            "/background-position-assets/",
            "/background-repeat/",
            "/background-repeat-assets/",
            "/background-size/",
            "/background-size-assets/",
            "/background-layers/",
            "/font-family/",
            "/display/",
            "/html-boxes/",
            "/html-boxes-assets/",
            "/display-assets/",
            "/font-family-assets/",
            "/background-layers-assets/",
            "/background-images-assets/",
            "/line-height-assets/",
            "/tabs-assets/",
            "/text-adjust/",
            "/text-adjust-assets/",
            "/outline-assets/",
            "/canvas/",
            "/borders/",
            "/css-budget/",
            "/css-budget-assets/",
            "/binary/",
            "/font-assets/",
            "/font-loading/",
            "/font-matching/",
        ]
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

fn serve_fonts(request: Request) -> io::Result<()> {
    let path = request.url().to_owned();
    let mut response = if path.starts_with("/font-loading/font/")
        || path.starts_with("/font-assets/font/")
    {
        Response::from_data(include_bytes!("fixtures/synthetic-font.ttf").to_vec())
            .with_header(header("Content-Type", "font/ttf")?)
    } else if let Some(variant) = path.strip_prefix("/font-assets/redirect/") {
        Response::from_data(Vec::new())
            .with_status_code(302)
            .with_header(header(
                "Location",
                &format!("/font-assets/styles/entry-{variant}.css"),
            )?)
    } else if let Some(variant) = path
        .strip_prefix("/font-assets/styles/entry-")
        .and_then(|value| value.strip_suffix(".css"))
    {
        Response::from_data(format!("@font-face{{font-family:NimboCSS{variant};src:url('../font/{variant}');font-style:italic;font-weight:700;font-display:swap}}"))
            .with_header(header("Content-Type", "text/css")?)
    } else if path.starts_with("/font-assets/invalid/") {
        Response::from_data(vec![1, 2, 3])
    } else if path.starts_with("/font-matching/") {
        Response::from_data(format!(
            "<!doctype html><meta charset=\"utf-8\"><script>{}</script>",
            include_str!("fixtures/font-matching.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/font-loading/") {
        let width = variant
            .parse::<usize>()
            .unwrap_or_default()
            .saturating_add(30);
        Response::from_data(format!("<!doctype html><link rel=stylesheet href='/font-assets/redirect/{variant}'><style>@font-face{{font-family:NimboInline{variant};src:url('/font-assets/font/{variant}')}}@font-face{{src:url('/font-assets/missing/{variant}')}}#geometry{{width:{width}px;height:10px}}</style><div id=geometry></div><script>{}</script>", include_str!("fixtures/font-loading.txt")))
            .with_header(header("Content-Type", "text/html")?)
    } else {
        Response::from_data(b"missing".to_vec()).with_status_code(404)
    };
    if path.starts_with("/font-assets/missing/") {
        response = response.with_status_code(404);
    }
    request.respond(response)
}

#[test]
fn css_fonts_register_and_load_through_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/font-loading/{variant}")))?;
        let result = page.evaluate(&format!("fontCase({variant})"))?;
        let fields = result.as_object().ok_or("missing font result")?;
        assert_eq!(fields.len(), 27);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn font_matching_selects_and_loads_real_http_fonts() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/font-matching/{variant}")))?;
        let result = page.evaluate(&format!("fontMatchCase({variant})"))?;
        let fields = result.as_object().ok_or("missing font matching result")?;
        assert_eq!(fields.len(), 55);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_css_budget(request: Request) -> io::Result<()> {
    let path = request.url();
    let variant = path
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .parse::<usize>()
        .unwrap_or_default();
    let (source, mime) = if path.starts_with("/css-budget/") {
        (
            format!(
                "<!doctype html><meta charset=utf-8><style id=inline>/*{}*/#target{{width:10px;height:15px}}</style><link id=first rel=stylesheet href='/css-budget-assets/first/{variant}'><link id=second rel=stylesheet href='/css-budget-assets/second/{variant}'><div id=target></div><script>{}</script>",
                "x".repeat(120_000),
                include_str!("fixtures/css-budget.txt")
            ),
            "text/html; charset=utf-8",
        )
    } else if path.starts_with("/css-budget-assets/first/") {
        (
            format!(
                "@media (min-width:1px){{/*{}*/#target{{width:{}px}}@font-face{{font-family:BudgetFont{variant};src:url('/font-assets/font/{variant}')}}}}",
                "é".repeat(150_000),
                variant.saturating_add(300)
            ),
            "text/css; charset=utf-8",
        )
    } else if path.starts_with("/css-budget-assets/replacement/") {
        (
            format!(
                "/*{}*/#target{{width:{}px}}",
                "x".repeat(320_000),
                variant.saturating_add(400)
            ),
            "text/css; charset=utf-8",
        )
    } else {
        (
            format!(
                "/*{}*/#target{{height:{}px}}",
                "x".repeat(150_000),
                variant.saturating_add(20)
            ),
            "text/css; charset=utf-8",
        )
    };
    request.respond(Response::from_data(source).with_header(header("Content-Type", mime)?))
}

#[test]
fn configured_stylesheet_budget_parses_large_real_http_sheets() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_stylesheet_bytes: 700_000,
            ..Limits::default()
        },
    )?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/css-budget/{variant}")))?;
        let result = page.evaluate(&format!("cssBudgetCase({variant})"))?;
        let fields = result.as_object().ok_or("missing CSS budget result")?;
        assert_eq!(fields.len(), 12);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn stylesheet_budget_configuration_rejects_limits_and_recovers() -> TestResult {
    let fixture = Fixture::new()?;
    assert!(
        Browser::new(
            &fixture.url,
            Limits {
                max_stylesheet_bytes: 0,
                ..Limits::default()
            }
        )
        .is_err()
    );
    let browser = fixture.browser()?;
    let failed = browser.navigate(&fixture.path("/css-budget/130"));
    assert!(matches!(
        failed,
        Err(Error::Limit("stylesheet total bytes"))
    ));
    let page = browser.navigate(&fixture.path("/empty-layout"))?;
    assert_eq!(page.evaluate("true")?, json!(true));
    Ok(())
}

fn serve_borders(request: Request) -> io::Result<()> {
    let source = format!(
        "<!doctype html><meta charset=utf-8><script>{}</script>",
        include_str!("fixtures/borders.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn physical_borders_compute_real_http_box_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/borders/{variant}")))?;
        let result = page.evaluate(&format!("borderCase({variant})"))?;
        let fields = result.as_object().ok_or("missing border result")?;
        assert_eq!(fields.len(), 54);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_canvas(request: Request) -> io::Result<()> {
    let source = format!(
        "<!doctype html><meta charset=utf-8><script>const canvasCompositingReference={};{}</script>",
        include_str!("fixtures/canvas-compositing-reference.json"),
        include_str!("fixtures/canvas.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn software_canvas_rasterizes_real_http_pixels() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/canvas/{variant}")))?;
        let result = page.evaluate(&format!("canvasCase({variant})"))?;
        let fields = result.as_object().ok_or("missing canvas result")?;
        assert_eq!(fields.len(), 55);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn software_canvas_uploads_real_http_pixels() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/canvas/{variant}")))?;
        let result = page.evaluate(&format!("canvasUploadCase({variant})"))?;
        let fields = result.as_object().ok_or("missing canvas upload result")?;
        assert_eq!(fields.len(), 30);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn software_canvas_composites_real_http_pixels() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/canvas/{variant}")))?;
        let result = page.evaluate(&format!("canvasCompositingCase({variant})"))?;
        let fields = result
            .get("checks")
            .and_then(serde_json::Value::as_object)
            .ok_or("missing compositing checks")?;
        assert_eq!(fields.len(), 222);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_layout_budget(request: Request) -> io::Result<()> {
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_default();
    let nodes = "<div></div>".repeat(1100);
    let source = format!(
        "<!doctype html><main id=\"root\" style=\"width:{}px;height:3px\">{nodes}</main><script>function layoutBudgetCase(v){{const root=document.querySelector('#root'),r=root.getBoundingClientRect();return {{width:r.width===8+v,height:r.height===3,edges:r.right-r.left===r.width&&r.bottom-r.top===r.height,origin:Number.isFinite(r.x)&&Number.isFinite(r.y),owner:root.children.length===1100,first:root.firstElementChild.tagName==='DIV',last:root.lastElementChild.tagName==='DIV',nodes:document.querySelectorAll('*').length===1105}}}}</script>",
        variant.saturating_add(8)
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn configured_layout_node_budget_measures_large_real_http_trees() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.path("/"),
        Limits {
            max_layout_nodes: 2048,
            ..Limits::default()
        },
    )?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/layout-budget/{variant}")))?;
        let result = page.evaluate(&format!("layoutBudgetCase({variant})"))?;
        let fields = result.as_object().ok_or("missing layout budget result")?;
        assert_eq!(fields.len(), 8);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    let limited = fixture.browser()?;
    let page = limited.navigate(&fixture.path("/layout-budget/0"))?;
    assert!(
        page.evaluate("layoutBudgetCase(0)")
            .is_err_and(|error| error.to_string().contains("layout tree: nodes"))
    );
    Ok(())
}

#[test]
fn logical_dimensions_cascade_real_http_boxes() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/logical-size/{variant}")))?;
        let result = page.evaluate(&format!("logicalSizeCase({variant})"))?;
        let fields = result
            .as_object()
            .ok_or("missing logical dimensions result")?;
        assert_eq!(fields.len(), 45);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn computed_outlines_real_http_live_styles() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/outlines/{variant}")))?;
        let result = page.evaluate(&format!("outlineCase({variant})"))?;
        let fields = result
            .as_object()
            .ok_or("missing computed outlines result")?;
        assert_eq!(fields.len(), 60);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_outlines(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/outline-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{outline:{}px solid red;outline-offset:{}px}}",
                variant.saturating_add(2),
                variant.saturating_add(1)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/outlines/").unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/outline-assets/{variant}><script>{}</script>",
        include_str!("fixtures/outlines.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn text_adjustment_real_http_cascade_and_aliases() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/text-adjust/{variant}")))?;
        let result = page.evaluate(&format!("textAdjustCase({variant})"))?;
        let fields = result.as_object().ok_or("missing text adjustment result")?;
        assert_eq!(fields.len(), 44);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_text_adjust(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/text-adjust-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{text-size-adjust:{}%}}",
                variant.saturating_add(50)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/text-adjust/").unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/text-adjust-assets/{variant}><script>{}</script>",
        include_str!("fixtures/text-adjust.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_tabs_real_http_computed_lengths() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/tabs/{variant}")))?;
        let result = page.evaluate(&format!("tabsCase({variant})"))?;
        let fields = result.as_object().ok_or("missing computed tabs result")?;
        assert_eq!(fields.len(), 46);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}
fn serve_tabs(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/tabs-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{tab-size:{}px}}",
                variant.saturating_add(3)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/tabs/").unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/tabs-assets/{variant}><script>{}</script>",
        include_str!("fixtures/tabs.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_line_height_real_http_inheritance() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/line-height/{variant}")))?;
        let result = page.evaluate(&format!("lineHeightCase({variant})"))?;
        let fields = result.as_object().ok_or("missing line height result")?;
        assert_eq!(fields.len(), 51);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}
fn serve_line_height(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/line-height-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{line-height:{}px}}",
                variant.saturating_add(3)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/line-height/").unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/line-height-assets/{variant}><script>{}</script>",
        include_str!("fixtures/line-height.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_background_image_layers_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/background-images/{variant}")))?;
        let result = page.evaluate(&format!("backgroundImagesCase({variant})"))?;
        let fields = result
            .as_object()
            .ok_or("missing background image result")?;
        assert_eq!(fields.len(), 48);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_background_images(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/background-images-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{background-image:linear-gradient(red {}px,blue)}}",
                variant.saturating_add(3)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request
        .url()
        .strip_prefix("/background-images/")
        .unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/background-images-assets/{variant}><script>{}</script>",
        include_str!("fixtures/background-images.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_background_position_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/background-position/{variant}")))?;
        let result = page.evaluate(&format!("backgroundPositionCase({variant})"))?;
        let fields = result
            .as_object()
            .ok_or("missing background position result")?;
        assert_eq!(fields.len(), 64);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_background_position(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/background-position-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{background-position:{}px 20%}}",
                variant.saturating_add(3)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request
        .url()
        .strip_prefix("/background-position/")
        .unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/background-position-assets/{variant}><script>{}</script>",
        include_str!("fixtures/background-position.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_background_repeat_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/background-repeat/{variant}")))?;
        let result = page.evaluate(&format!("backgroundRepeatCase({variant})"))?;
        let fields = result
            .as_object()
            .ok_or("missing background repeat result")?;
        assert_eq!(fields.len(), 66);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_background_repeat(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/background-repeat-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{background-repeat:{}}}",
                if variant % 2 == 0 {
                    "repeat-x"
                } else {
                    "repeat-y"
                }
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request
        .url()
        .strip_prefix("/background-repeat/")
        .unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/background-repeat-assets/{variant}><script>{}</script>",
        include_str!("fixtures/background-repeat.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_background_size_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/background-size/{variant}")))?;
        let result = page.evaluate(&format!("backgroundSizeCase({variant})"))?;
        let fields = result.as_object().ok_or("missing background size result")?;
        assert_eq!(fields.len(), 71);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_background_size(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/background-size-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{background-size:{}px}}",
                variant.saturating_add(3)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request
        .url()
        .strip_prefix("/background-size/")
        .unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/background-size-assets/{variant}><script>{}</script>",
        include_str!("fixtures/background-size.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_background_layers_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/background-layers/{variant}")))?;
        let result = page.evaluate(&format!("backgroundLayersCase({variant})"))?;
        let fields = result
            .as_object()
            .ok_or("missing background layer result")?;
        assert_eq!(fields.len(), 143);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

fn serve_background_layers(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/background-layers-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(Response::from_string(format!("#external{{background-attachment:{};background-origin:content-box;background-clip:padding-box}}",if variant % 2 == 0 {"fixed"} else {"local"})).with_header(header("Content-Type", "text/css")?));
    }
    let variant = request
        .url()
        .strip_prefix("/background-layers/")
        .unwrap_or("0");
    let source = format!(
        "<!doctype html><meta charset=utf-8><link rel=stylesheet href=/background-layers-assets/{variant}><script>{}</script>",
        include_str!("fixtures/background-layers.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_font_family_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/font-family/{variant}")))?;
        let result = page.evaluate(&format!("fontFamilyCase({variant})"))?;
        let fields = result.as_object().ok_or("missing font family result")?;
        assert_eq!(fields.len(), 75);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}
fn serve_font_family(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/font-family-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{font-family:\"External {variant}\",serif}}"
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/font-family/").unwrap_or("0");
    let source = format!(
        "<!doctype html><link rel=stylesheet href=/font-family-assets/{variant}><script>{}</script>",
        include_str!("fixtures/font-family.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_display_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/display/{variant}")))?;
        let result = page.evaluate(&format!("displayCase({variant})"))?;
        let fields = result.as_object().ok_or("missing display result")?;
        assert_eq!(fields.len(), 105);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}
fn serve_display(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/display-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{display:{}}}",
                if variant % 2 == 0 {
                    "inline-flex"
                } else {
                    "inline-grid"
                }
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/display/").unwrap_or("0");
    let source = format!(
        "<!doctype html><link rel=stylesheet href=/display-assets/{variant}><script>{}</script>",
        include_str!("fixtures/display.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_html_boxes_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        for group in 0..4 {
            let page = browser.navigate(&fixture.path(&format!("/html-boxes/{variant}")))?;
            let result = page.evaluate(&format!("htmlBoxesCase({variant},{group})"))?;
            let fields = result.as_object().ok_or("missing HTML box result")?;
            assert_eq!(fields.len(), if group == 3 { 24 } else { 51 });
            assert!(
                fields
                    .iter()
                    .all(|(name, value)| *value == json!(name != "externalMutation")),
                "variant {variant}, group {group}: {result}"
            );
        }
    }
    Ok(())
}
fn serve_html_boxes(request: Request) -> io::Result<()> {
    if let Some(value) = request.url().strip_prefix("/html-boxes-assets/") {
        let variant = value.parse::<u32>().map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#external{{display:block;width:{}px;height:{}px}}",
                variant.saturating_add(7),
                (variant % 6).saturating_add(3)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let variant = request.url().strip_prefix("/html-boxes/").unwrap_or("0");
    let source = format!(
        "<!doctype html><link rel=stylesheet href=/html-boxes-assets/{variant}><script>{}</script>",
        include_str!("fixtures/html-boxes.txt")
    );
    request.respond(Response::from_string(source).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn native_constructed_stylesheets_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/constructed-sheets/{variant}")))?;
        let result = page.evaluate(&format!("constructedSheetsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing CSSOM checks")?;
        assert_eq!(checks.len(), 46);
        assert!(
            checks
                .iter()
                .all(|(name, check)| *check == json!(name != "nonconfigIndexDefine")),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn native_adopted_stylesheets_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/adopted-sheets/{variant}")))?;
        let result = page.evaluate(&format!("adoptedSheetsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing adoption checks")?;
        assert_eq!(checks.len(), 36);
        assert!(
            checks.values().all(|check| *check == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn native_large_dom_js_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/large-dom/{variant}")))?;
        let expression = format!("largeDomCase({variant})");
        assert_eq!(
            page.evaluate(&expression)?,
            json!({"value":"row","changed":format!("updated-{variant}"),"count":5000,"keys":5000,"retained":true,"remaining":4999,"last":"row"})
        );
    }
    Ok(())
}

#[test]
fn native_link_free_guard_discovers_dynamic_stylesheets() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for setup in [
        "const link=document.createElement('LINK');link.setAttribute('rel','stylesheet');link.setAttribute('href','/link-guard.css');document.head.appendChild(link);",
        "document.head.innerHTML='<li'+'Nk rel=stylesheet href=/link-guard.css>';const link=document.head.querySelector('link');",
    ] {
        let page = browser.navigate(&fixture.path("/link-guard/page"))?;
        let expression = format!(
            "(()=>{{{setup}return new Promise(resolve=>link.addEventListener('load',()=>resolve(getComputedStyle(document.getElementById('target')).color)))}})()"
        );
        assert_eq!(page.evaluate(&expression)?, json!("rgb(7, 8, 9)"));
    }
    Ok(())
}

fn serve_dom_resources(request: Request) -> io::Result<()> {
    if request.url().starts_with("/response-encoding/") {
        let cases: Vec<EncodingCase> =
            serde_json::from_str(include_str!("fixtures/response-encoding.json"))?;
        let index = request
            .url()
            .split('/')
            .nth(2)
            .and_then(|index| index.parse::<usize>().ok())
            .unwrap_or(usize::MAX);
        let Some(case) = cases.get(index) else {
            return request.respond(Response::empty(404));
        };
        return request.respond(
            Response::from_data(case.bytes.clone())
                .with_header(header("Content-Type", &case.content_type)?),
        );
    }

    if request.url().starts_with("/urls/") {
        return request.respond(
            Response::from_string(format!(
                "<!doctype html><meta charset=utf-8>{}",
                script_fixture(include_str!("fixtures/urls.txt"))
            ))
            .with_header(header("Content-Type", "text/html")?),
        );
    }
    if request.url().starts_with("/namespaced-elements/") {
        return request.respond(
            Response::from_string(format!(
                "<!doctype html><script>{}</script>",
                include_str!("fixtures/namespaced-elements.txt")
            ))
            .with_header(header("Content-Type", "text/html")?),
        );
    }
    if let Some(value) = request.url().strip_prefix("/sticky-geometry/") {
        let variant = value.parse::<u8>().map_err(io::Error::other)?;
        return request.respond(Response::from_string(format!(
            "<!doctype html><body><script>{}\nglobalThis.comparison=stickyGeometryCase({variant})</script>",
            include_str!("fixtures/sticky-geometry.txt")
        )).with_header(header("Content-Type", "text/html")?));
    }
    if request.url().starts_with("/positioned-boxes/") {
        return request.respond(
            Response::from_string(format!(
                "<!doctype html><script>{}</script>",
                include_str!("fixtures/positioned-boxes.txt")
            ))
            .with_header(header("Content-Type", "text/html")?),
        );
    }
    if request.url().starts_with("/custom-boxes/") {
        return request.respond(
            Response::from_string(format!(
                "<script>{}</script>",
                include_str!("fixtures/custom-boxes.txt")
            ))
            .with_header(header("Content-Type", "text/html")?),
        );
    }
    if request.url() == "/link-guard.css" {
        return request.respond(
            Response::from_string("#target {color:rgb(7,8,9)}")
                .with_header(header("Content-Type", "text/css")?),
        );
    }
    if request.url().starts_with("/link-guard/") {
        return request.respond(
            Response::from_string("<div id=target></div>")
                .with_header(header("Content-Type", "text/html")?),
        );
    }
    if request.url().starts_with("/large-dom/") {
        return request.respond(
            Response::from_string(format!(
                "<main><ul>{}</ul></main><script>{}</script>",
                "<li class=entry>row</li>".repeat(5000),
                include_str!("fixtures/large-dom.txt")
            ))
            .with_header(header("Content-Type", "text/html")?),
        );
    }
    if request.url().starts_with("/adopted-sheets/") {
        return request.respond(Response::from_string(format!("<!doctype html><style>html,body {{margin:0;padding:0}} #target {{width:3px;height:2px;color:rgb(1,2,3)}}</style><div id=target></div><script>{}</script>",include_str!("fixtures/adopted-sheets.txt"))).with_header(header("Content-Type", "text/html")?));
    }
    if request.url().starts_with("/constructed-sheets/") {
        return request.respond(
            Response::from_string(format!(
                "<!doctype html><script>{}</script>",
                include_str!("fixtures/constructed-sheets.txt")
            ))
            .with_header(header("Content-Type", "text/html")?),
        );
    }
    request.respond(Response::empty(404))
}

#[test]
fn custom_elements_and_contents_use_real_box_tree() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/custom-boxes/{variant}")))?;
        let result = page.evaluate(&format!("customBoxesCase({variant})"))?;
        let checks = result.as_object().ok_or("missing checks")?;
        assert_eq!(checks.len(), 26);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
    }
    Ok(())
}

#[test]
fn positioned_boxes_use_containing_blocks_and_viewport() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/positioned-boxes/{variant}")))?;
        let result = page.evaluate(&format!("positionedBoxesCase({variant})"))?;
        let checks = result.as_object().ok_or("missing checks")?;
        assert_eq!(checks.len(), 25);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
    }
    Ok(())
}

#[test]
fn namespaced_elements_preserve_native_names_and_interfaces() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/namespaced-elements/{variant}")))?;
        let result = page.evaluate(&format!("namespacedElementsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing namespace checks")?;
        assert_eq!(checks.len(), 38);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct EncodingCase {
    bytes: Vec<u8>,
    content_type: String,
    expected: String,
}

#[test]
fn response_encodings_decode_before_dom_and_javascript() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let cases: Vec<EncodingCase> =
        serde_json::from_str(include_str!("fixtures/response-encoding.json"))?;
    for (index, case) in cases.iter().enumerate() {
        for variant in 0..8 {
            let page = browser
                .navigate(&fixture.path(&format!("/response-encoding/{index}/{variant}")))?;
            assert_eq!(
                page.evaluate(
                    "({dom:document.getElementById('out').textContent,script:encodingResult})"
                )?,
                json!({"dom":case.expected,"script":case.expected})
            );
        }
    }
    Ok(())
}

#[test]
fn url_objects_and_live_queries_use_native_url_parser() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/urls/{variant}")))?;
        let result = page.evaluate(&format!("urlsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing URL checks")?;
        assert_eq!(checks.len(), 42);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
    }
    Ok(())
}

#[test]
fn url_limits_preserve_state_and_allow_recovery() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/urls/0"))?;
    assert_eq!(
        page.evaluate("urlsLimitsCase()")?,
        json!({"boundedURL":true,"boundedQuery":true,"statePreserved":true,"recovered":true})
    );
    Ok(())
}

#[test]
fn document_cookies_share_real_http_state_and_keep_attributes() -> TestResult {
    let fixture = Fixture::new()?;
    for variant in 0..64 {
        let browser = fixture.browser()?;
        let page = browser.navigate(&fixture.path(&format!("/cookies/{variant}")))?;
        let result = page.evaluate(&format!("cookiesCase({variant})"))?;
        let checks = result.as_object().ok_or("missing cookie results")?;
        assert_eq!(checks.len(), 14);
        for (name, passed) in checks {
            assert_eq!(*passed, json!(true), "variant {variant}: {name}");
        }
        let next = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(
            next.evaluate(&format!("document.cookie.includes('variant={variant}')"))?,
            json!(true)
        );
        let isolated = fixture.browser()?.navigate(&fixture.path("/static"))?;
        assert_eq!(isolated.evaluate("document.cookie")?, json!(""));
    }
    Ok(())
}

#[test]
fn document_cookies_expire_with_real_time_and_recover_from_budgets() -> TestResult {
    let fixture = Fixture::new()?;
    for (function, expected) in [
        (
            "cookiesExpirationCase",
            json!({"before":true,"after":true,"httpExpired":true}),
        ),
        (
            "cookiesCountCase",
            json!({"limited":true,"count":true,"atomic":true,"recovered":true}),
        ),
        (
            "cookiesBytesCase",
            json!({"limited":true,"bytes":true,"atomic":true,"recovered":true}),
        ),
    ] {
        let browser = fixture.browser()?;
        let page = browser.navigate(&fixture.path("/cookies/0"))?;
        assert_eq!(
            page.evaluate(&format!("{function}()"))?,
            expected,
            "{function}"
        );
    }
    Ok(())
}

#[test]
fn sticky_geometry_tracks_scroll_and_containing_blocks() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/sticky-geometry/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing sticky checks")?;
        assert_eq!(checks.len(), 28);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
    }
    Ok(())
}

#[test]
fn z_index_computes_cascade_without_changing_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for variant in 0..64 {
        let page = browser.navigate(&fixture.path(&format!("/z-index/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing z-index checks")?;
        assert_eq!(checks.len(), 39);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
    }
    Ok(())
}

fn serve_z_index(request: Request) -> io::Result<()> {
    if request.url() == "/z-index-style" {
        return request.respond(
            Response::from_string("#external{z-index:29!important}")
                .with_header(header("Content-Type", "text/css")?),
        );
    }
    if let Some(value) = request.url().strip_prefix("/z-index/") {
        let variant = value.parse::<u8>().map_err(io::Error::other)?;
        return request.respond(Response::from_string(format!(
            "<!doctype html><link rel=\"stylesheet\" href=\"/z-index-style\"><body><script>{}\nglobalThis.comparison=zIndexCase({variant})</script>",
            include_str!("fixtures/z-index.txt")
        )).with_header(header("Content-Type", "text/html")?));
    }
    request.respond(Response::empty(404))
}
