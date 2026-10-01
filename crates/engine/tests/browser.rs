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

fn serve(mut request: Request) -> io::Result<()> {
    let mut content_type = "text/html; charset=utf-8";
    let mut status = 200;
    let mut headers = Vec::new();
    let body = match request.url() {
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
    for path in ["/async", "/iframe", "/base"] {
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
