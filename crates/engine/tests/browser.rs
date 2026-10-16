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

use nimbo_engine::{Browser, Error, Limits, MediaEnvironment, Readiness, ReadyCondition};
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

/// Caps concurrent variant pages across all tests at the CPU count, so parallel
/// tests do not oversubscribe the host and skew real-time deadlines.
struct PagePermit;

static PAGES: (std::sync::Mutex<usize>, std::sync::Condvar) =
    (std::sync::Mutex::new(0), std::sync::Condvar::new());

impl PagePermit {
    fn acquire() -> Self {
        let limit = thread::available_parallelism().map_or(4, std::num::NonZero::get);
        let mut active = PAGES
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while *active >= limit {
            active = PAGES
                .1
                .wait(active)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        *active = active.saturating_add(1);
        drop(active);
        Self
    }
}

impl Drop for PagePermit {
    fn drop(&mut self) {
        {
            let mut active = PAGES
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *active = active.saturating_sub(1);
        }
        PAGES.1.notify_one();
    }
}

/// Runs `check` for all 64 variants across worker threads, each with its own
/// browser because `Browser` is neither `Send` nor `Sync`.
fn each_variant(
    fixture: &Fixture,
    check: impl Fn(&Browser, usize) -> TestResult + Sync,
) -> TestResult {
    let workers = thread::available_parallelism()
        .map_or(4, std::num::NonZero::get)
        .min(8);
    thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                let check = &check;
                scope.spawn(move || -> Result<(), String> {
                    let browser = fixture.browser().map_err(|error| error.to_string())?;
                    for variant in (worker..64).step_by(workers) {
                        let _permit = PagePermit::acquire();
                        check(&browser, variant)
                            .map_err(|error| format!("variant {variant}: {error}"))?;
                    }
                    Ok(())
                })
            })
            .collect();
        for handle in handles {
            handle
                .join()
                .map_err(|_panic| "variant worker panicked")??;
        }
        Ok(())
    })
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

fn infinite_fixture(path: &str) -> String {
    script_fixture(if path == "/lifecycle-infinite" {
        "document.addEventListener('DOMContentLoaded',()=>{while(true){}})"
    } else {
        "while (true) {}"
    })
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
    let imported: std::collections::HashMap<String, String> =
        serde_json::from_str(include_str!("fixtures/stylesheet-imports.json"))
            .map_err(io::Error::other)?;
    if let Some(body) = path
        .strip_prefix("/sheets-css/")
        .and_then(|key| imported.get(key))
    {
        return respond(request, body.clone(), 200, "text/css", Vec::new());
    }
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

fn serve_stealth(request: Request) -> io::Result<()> {
    let agent = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("User-Agent"))
        .map_or("", |header| header.value.as_str())
        .to_owned();
    if request.url() == "/stealth-echo" {
        return respond(
            request,
            json!({"userAgent":agent}).to_string(),
            200,
            "application/json",
            Vec::new(),
        );
    }
    let body = format!(
        "<!doctype html><body><script>globalThis.httpAgent={};{}</script>",
        json!(agent),
        include_str!("fixtures/stealth.txt")
    );
    respond(request, body, 200, "text/html; charset=utf-8", Vec::new())
}

fn request_cookie(request: &Request) -> &str {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Cookie"))
        .map_or("", |header| header.value.as_str())
}

fn serve_readiness(request: Request) -> io::Result<()> {
    let body = if request.url() == "/readiness" {
        format!(
            "<!doctype html><body>{}",
            script_fixture(include_str!("fixtures/readiness.txt"))
        )
    } else {
        "ready".into()
    };
    respond(request, body, 200, "text/html", Vec::new())
}

fn serve_variant(request: Request, source: &str) -> io::Result<()> {
    let variant = request
        .url()
        .split('/')
        .next_back()
        .unwrap_or("0")
        .parse::<u32>()
        .map_err(io::Error::other)?;
    let body = format!("<!doctype html><body><script>const variant={variant};{source}</script>");
    respond(request, body, 200, "text/html", Vec::new())
}

fn serve_history(request: Request) -> io::Result<()> {
    let path = request.url();
    if std::path::Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("css"))
    {
        return respond(
            request,
            "body{color:rgb(1,2,3)}".into(),
            200,
            "text/css",
            Vec::new(),
        );
    }
    if std::path::Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        let body = json!({"path":path,"cookie":request_cookie(&request)}).to_string();
        return respond(request, body, 200, "application/json", Vec::new());
    }
    let variant = path
        .split('/')
        .next_back()
        .unwrap_or("0")
        .parse::<u32>()
        .map_err(io::Error::other)?;
    let source = include_str!("fixtures/history.txt");
    let body = format!(
        r#"<!doctype html><head><link rel="stylesheet" href="style.css"></head><body><script>const variant={variant};{source}</script>"#
    );
    respond(request, body, 200, "text/html", Vec::new())
}

fn serve_framework(request: Request) -> io::Result<()> {
    let path = request.url();
    let module = match path {
        "/frameworks/preact.mjs" => Some(include_str!("fixtures/frameworks/preact-10.29.8.txt")),
        "/frameworks/vue.mjs" => Some(include_str!("fixtures/frameworks/vue-3.5.22.txt")),
        "/frameworks/preact/adapter.mjs" => {
            Some(include_str!("fixtures/frameworks/preact-adapter.txt"))
        }
        "/frameworks/vue/adapter.mjs" => Some(include_str!("fixtures/frameworks/vue-adapter.txt")),
        _ => None,
    };
    if let Some(module) = module {
        return respond(request, module.into(), 200, "text/javascript", Vec::new());
    }
    let mut parts = path.split('/').skip(2);
    let framework = parts.next().unwrap_or_default();
    let variant = parts
        .next()
        .unwrap_or_default()
        .parse::<u32>()
        .map_err(io::Error::other)?;
    if framework == "data" {
        let body = json!({"message": format!("loaded-{variant}"),"path":path}).to_string();
        return respond(request, body, 200, "application/json", Vec::new());
    }
    let body = if framework == "dom-primitives" {
        let source = include_str!("fixtures/frameworks/dom-primitives.txt");
        format!("<!doctype html><body><script>const variant={variant};{source}</script>")
    } else {
        let source = include_str!("fixtures/frameworks/app.txt").replace(
            "'/frameworks/adapter.mjs'",
            &format!("'/frameworks/{framework}/adapter.mjs'"),
        );
        format!(
            r#"<!doctype html><div id="app"><main><p id="count">Count: {variant}</p><button id="increment">Increment</button><ul><li data-key="1">1</li><li data-key="2">2</li><li data-key="3">3</li></ul><p id="message">server</p></main></div><script type="module">const variant={variant};{source}</script>"#
        )
    };
    respond(request, body, 200, "text/html", Vec::new())
}

fn variant_source(url: &str) -> Option<&'static str> {
    match url.split('/').nth(1) {
        Some("shadow-dom") => Some(include_str!("fixtures/shadow-dom.txt")),
        Some("mutation-observer") => Some(include_str!("fixtures/mutation-observer.txt")),
        _ => None,
    }
}

fn serve(request: Request) -> io::Result<()> {
    if request.url().starts_with("/image-resources/") {
        return serve_image_resources(request);
    }
    if request.url() == "/rejected-dom" {
        return respond(request, "<script>Promise.reject(new DOMException('native-rejected-dom','NotAllowedError'));</script>".into(), 200, "text/html", Vec::new());
    }
    if request.url() == "/rejected-value" {
        return respond(
            request,
            "<script>Promise.reject('native-rejected-value');</script>".into(),
            200,
            "text/html",
            Vec::new(),
        );
    }

    if request.url() == "/current-script" {
        return respond(
            request,
            include_str!("fixtures/current-script.html").into(),
            200,
            "text/html",
            Vec::new(),
        );
    }
    if request.url().starts_with("/current-script.js") {
        return respond(
            request,
            include_str!("fixtures/current-script-source.txt").into(),
            200,
            "text/javascript",
            Vec::new(),
        );
    }

    if request.url() == "/script-resources" {
        return respond(
            request,
            "<script>globalThis.order=[];for(const type of ['load','error'])document.addEventListener(type,event=>{if(event.target.tagName==='SCRIPT')order.push(event.target.id+':'+type)},true);addEventListener('load',()=>order.push('window-load'))</script><script id=missing src=/missing></script><script id=ok src=/script-resource.js></script><script>order.push('after')</script>".into(),
            200,
            "text/html",
            Vec::new(),
        );
    }
    if request.url() == "/script-resource.js" {
        return respond(
            request,
            "order.push('script');Promise.resolve().then(()=>order.push('microtask'))".into(),
            200,
            "text/javascript",
            Vec::new(),
        );
    }
    if request.url() == "/async-inline" {
        return respond(
            request,
            "<script async>globalThis.order=['inline'];globalThis.phase=document.readyState</script><script async defer>order.push('next')</script><script type='application/json' async>{}</script>".into(),
            200,
            "text/html",
            Vec::new(),
        );
    }
    if request.url().starts_with("/history/") {
        return serve_history(request);
    }
    if request.url().starts_with("/frameworks/") {
        return serve_framework(request);
    }
    if let Some(source) = variant_source(request.url()) {
        return serve_variant(request, source);
    }
    if matches!(request.url(), "/readiness" | "/readiness-data") {
        return serve_readiness(request);
    }
    if is_resource(request.url()) {
        return serve_resource(request);
    }

    serve_page(request)
}

fn serve_page(mut request: Request) -> io::Result<()> {
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
        "/cookie" => format!("<main>{}</main>", request_cookie(&request)),
        "/infinite" | "/lifecycle-infinite" => infinite_fixture(request.url()),
        "/bad-js" => "<script>const = ;</script>".into(),
        "/rejected" => "<script>Promise.reject(new Error('failed'));</script>".into(),
        "/caught" => {
            "<script>Promise.reject(new Error('expected')).catch(() => {});</script><main>ok</main>"
                .into()
        }
        "/cross-script" => "<script>globalThis.blocked=false;document.addEventListener('error',()=>blocked=true,true)</script><script src='http://localhost:9/blocked'></script>".into(),
        "/cross-fetch" => "<script>fetch('http://localhost:9/blocked');</script>".into(),
        "/module" => "<script type='module'>export {};</script>".into(),
        "/import-map" => r#"<script type="importmap">{"imports":{"value":"/modules/shared.js","pkg/":"/mapped/","blocked":null},"scopes":{"/mapped/":{"value":"/mapped/value.js"}}}</script><script type="module" src="/mapped/root.js"></script>"#.into(),
        "/mapped/root.js" => {
            content_type = "text/javascript";
            "import {value} from 'value'; import {readA} from 'pkg/a.js'; globalThis.mapResult={value,cycle:readA()};".into()
        }
        "/mapped/value.js" => {content_type="text/javascript"; "export const value=73;".into()},
        "/mapped/a.js" => {content_type="text/javascript"; "import {readB} from './b.js'; export const a=3; export function readA(){return a+readB();}".into()},
        "/mapped/b.js" => {content_type="text/javascript"; "import {a} from './a.js'; export function readB(){return a+4;}".into()},
        "/import-map-late" => r#"<script>globalThis.started=true</script><script type="importmap">{}</script>"#.into(),
        "/import-map-cross" => r#"<script type="importmap">{"imports":{"value":"https://example.test/blocked.js"}}</script><script type="module">import 'value';</script>"#.into(),
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
        "/async-module" => "<script type='module' async src='/assets/app.js'></script>".into(),
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
fn blocks_cross_origin_requests_and_reports_denied_script_resources() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    assert!(matches!(
        browser.navigate(&fixture.path("/redirect-cross")),
        Err(Error::Origin(_))
    ));
    let denied = browser.navigate(&fixture.path("/cross-script"))?;
    assert_eq!(denied.evaluate("blocked")?, json!(true));
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
fn current_script_and_source_reflection_follow_execution_lifetime() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/current-script"))?;
    let result =
        page.evaluate("({...scriptChecks,extractionNull:document.currentScript===null})")?;
    let checks = result.as_object().ok_or("missing script checks")?;
    assert_eq!(checks.len(), 27);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn promise_rejection_reasons_preserve_native_diagnostics_and_recovery() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for _ in 0..5 {
        for (path, reason) in [
            ("/rejected", "failed"),
            ("/rejected-dom", "NotAllowedError: native-rejected-dom"),
            ("/rejected-value", "native-rejected-value"),
        ] {
            let error = browser
                .navigate(&fixture.path(path))
                .err()
                .ok_or("expected rejected promise")?;
            assert!(error.to_string().contains(reason), "{error}");
            if path == "/rejected" {
                assert!(error.to_string().contains(&fixture.path(path)), "{error}");
            }
        }
        let page = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(page.evaluate("document.title")?, json!("Página estática"));
    }
    Ok(())
}

#[test]
fn script_resource_failures_and_load_events_preserve_execution_order() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/script-resources"))?;
    assert_eq!(
        page.evaluate("order")?,
        json!([
            "missing:error",
            "script",
            "microtask",
            "ok:load",
            "after",
            "window-load"
        ])
    );
    Ok(())
}

#[test]
fn inline_classic_scripts_ignore_async_and_defer_attributes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/async-inline"))?;
    assert_eq!(
        page.evaluate("({order,phase,ready:document.readyState})")?,
        json!({"order":["inline","next"],"phase":"loading","ready":"complete"})
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
    for path in ["/async-module", "/iframe"] {
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
        for path in ["/cross-fetch", "/bad-js", "/rejected"] {
            assert!(browser.navigate(&fixture.path(path)).is_err());
        }
        let denied = browser.navigate(&fixture.path("/cross-script"))?;
        assert_eq!(denied.evaluate("blocked")?, json!(true));
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
            timeout: Duration::from_millis(500),
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let start = Instant::now();
    assert!(matches!(
        page.evaluate("new Promise(resolve => setTimeout(resolve, 60000))"),
        Err(Error::Limit("navigation deadline"))
    ));
    assert!(start.elapsed() < Duration::from_secs(2));
    Ok(())
}

#[test]
fn native_import_maps_resolve_scopes_and_cyclic_live_exports() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/import-map"))?;
    assert_eq!(page.evaluate("mapResult")?, json!({"value":73,"cycle":10}));
    assert_eq!(
        page.evaluate("import('pkg/a.js').then(ns=>ns.readA())")?,
        json!(10)
    );
    assert!(page.evaluate("import('blocked')").is_err());
    assert!(page.evaluate("import('pkg/../escape.js')").is_err());
    assert!(browser.navigate(&fixture.path("/import-map-late")).is_err());
    assert!(
        browser
            .navigate(&fixture.path("/import-map-cross"))
            .is_err()
    );
    assert_eq!(
        browser
            .navigate(&fixture.path("/static"))?
            .evaluate("typeof mapResult")?,
        json!("undefined")
    );
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
    assert_eq!(fields.len(), 38);
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
    assert_eq!(fields.len(), 77);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

fn serve_image_resources(request: Request) -> io::Result<()> {
    if request.url() == "/image-resources/empty-source" {
        return respond(
            request,
            include_str!("fixtures/image-resources/empty-source.html").into(),
            200,
            "text/html",
            Vec::new(),
        );
    }
    if matches!(
        request.url(),
        "/image-resources/inert.png"
            | "/image-resources/auto-shadow.png"
            | "/image-resources/auto-detached.png"
    ) {
        let cookie = format!(
            "image-{}=ready; Path=/image-resources/; SameSite=Lax",
            request
                .url()
                .trim_start_matches("/image-resources/")
                .trim_end_matches(".png")
        );
        return request.respond(
            Response::from_data(include_bytes!("fixtures/image-resources/small.png").as_slice())
                .with_header(header("Content-Type", "image/png")?)
                .with_header(header("Set-Cookie", &cookie)?),
        );
    }
    if let Some(method) = request
        .url()
        .strip_prefix("/image-resources/retry-")
        .and_then(|name| name.strip_suffix(".png"))
    {
        let cookie = format!("image-{method}=ready");
        let ready = request.headers().iter().any(|header| {
            header.field.equiv("Cookie")
                && header
                    .value
                    .as_str()
                    .split(';')
                    .any(|value| value.trim() == cookie)
        });
        let body: &[u8] = if ready {
            include_bytes!("fixtures/image-resources/small.png")
        } else {
            b"invalid image"
        };
        return request.respond(
            Response::from_data(body)
                .with_header(header("Content-Type", "image/png")?)
                .with_header(header("Cache-Control", "no-store")?)
                .with_header(header(
                    "Set-Cookie",
                    &format!("{cookie}; Path=/image-resources/; SameSite=Lax"),
                )?),
        );
    }
    if request.url() == "/image-resources/page" {
        const BODY: &str = "<!doctype html><img id=loaded src=/image-resources/small.png>";
        const METHODS: [&str; 6] = [
            "property",
            "namespace",
            "attribute",
            "inert",
            "auto-shadow",
            "auto-detached",
        ];
        let headers = METHODS
            .iter()
            .map(|method| {
                header(
                    "Set-Cookie",
                    &format!("image-{method}=; Max-Age=0; Path=/image-resources/"),
                )
            })
            .collect::<io::Result<Vec<_>>>()?;
        return respond(request, BODY.into(), 200, "text/html", headers);
    }
    if request.url() == "/image-resources/empty" {
        return respond(
            request,
            "<!doctype html><body></body>".into(),
            200,
            "text/html",
            Vec::new(),
        );
    }
    serve_image_bitmap(request)
}

fn serve_image_bitmap(request: Request) -> io::Result<()> {
    let path = request.url().split('?').next().unwrap_or_default();
    if matches!(
        path,
        "/image-resources/slow.png" | "/image-resources/slow-large.png"
    ) {
        thread::sleep(Duration::from_millis(40));
    }
    let (body, kind): (&[u8], &str) = match path {
        "/image-resources/small.png" | "/image-resources/slow.png" => (
            include_bytes!("fixtures/image-resources/small.png"),
            "image/png",
        ),
        "/image-resources/large.png" | "/image-resources/slow-large.png" => (
            include_bytes!("fixtures/image-resources/large.png"),
            "image/png",
        ),
        "/image-resources/small.jpeg" => (
            include_bytes!("fixtures/image-resources/small.jpeg"),
            "image/jpeg",
        ),
        "/image-resources/oriented.jpeg" => (
            include_bytes!("fixtures/image-resources/oriented.jpeg"),
            "image/jpeg",
        ),
        "/image-resources/small.gif" => (
            include_bytes!("fixtures/image-resources/small.gif"),
            "image/gif",
        ),
        "/image-resources/small.webp" => (
            include_bytes!("fixtures/image-resources/small.webp"),
            "image/webp",
        ),
        "/image-resources/truncated.png" => (
            include_bytes!("fixtures/image-resources/small.png")
                .get(..40)
                .ok_or_else(|| io::Error::other("missing synthetic PNG header"))?,
            "image/png",
        ),
        _ => (b"invalid image", "image/png"),
    };
    request.respond(
        Response::from_data(body)
            .with_header(header("Content-Type", kind)?)
            .with_header(header("Cache-Control", "no-store")?),
    )
}

fn is_dom_resource(path: &str) -> bool {
    [
        "/link-guard",
        "/large-dom/",
        "/custom-boxes/",
        "/positioned-boxes/",
        "/sticky-geometry/",
        "/logical-spacing/",
        "/logical-spacing-transitions/",
        "/logical-spacing-style",
        "/transitions/",
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

fn is_logical_spacing_resource(path: &str) -> bool {
    path.starts_with("/logical-spacing/")
        || path.starts_with("/logical-spacing-transitions/")
        || path == "/logical-spacing-style"
}

fn serve_resource(request: Request) -> io::Result<()> {
    if matches!(request.url(), "/stealth" | "/stealth-echo") {
        return serve_stealth(request);
    }
    if is_logical_spacing_resource(request.url()) {
        return serve_logical_spacing(request);
    }
    if request.url().starts_with("/transitions/") {
        return serve_transitions(request);
    }
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
        return serve_logical_size(request);
    }
    if is_script_resource(request.url()) {
        return serve_scripts(request);
    }
    if request.url().starts_with("/svg-viewport/") {
        return serve_svg_viewport(request);
    }
    if request.url().starts_with("/resolved-box-values/") {
        return serve_resolved_box_values(request);
    }
    if request.url().starts_with("/contextual-box-lengths/") {
        return serve_contextual_box_lengths(request);
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
    serve_remaining_resource(request)
}

fn serve_remaining_resource(request: Request) -> io::Result<()> {
    if request.url().starts_with("/font-assets/")
        || request.url().starts_with("/font-loading/")
        || request.url().starts_with("/font-matching/")
        || request.url().starts_with("/text-layout/")
        || request.url().starts_with("/font-profile/")
        || request.url().starts_with("/order-layout/")
        || request.url().starts_with("/anonymous-text/")
        || request.url().starts_with("/authored-button/")
        || request.url().starts_with("/font-settings/")
        || request.url().starts_with("/text-baseline/")
        || request.url().starts_with("/atomic-inline/")
        || request.url().starts_with("/rounded-box/")
        || request.url().starts_with("/clip-geometry/")
        || request.url().starts_with("/positioned-generated/")
        || request.url().starts_with("/text-transform/")
        || request.url().starts_with("/adjacent-element/")
        || request.url().starts_with("/logical-borders/")
        || request.url().starts_with("/explicit-grid/")
        || request.url().starts_with("/paragraph-wrap/")
        || request.url().starts_with("/headings/")
        || request.url().starts_with("/translation/")
        || request.url().starts_with("/canvas-box/")
        || request.url().starts_with("/box-shadow-geometry/")
        || request.url().starts_with("/public-font-assets/")
        || request.url().starts_with("/font-shaping/")
        || request.url().starts_with("/font-shaping-assets/")
        || request.url().starts_with("/font-scripts/")
        || request.url().starts_with("/font-scripts-assets/")
        || request.url().starts_with("/font-fallback/")
        || request.url().starts_with("/font-fallback-assets/")
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
    } else if path == "/binary/echo" {
        let value = |name: &'static str| {
            request
                .headers()
                .iter()
                .find(|header| header.field.equiv(name))
                .map(|header| header.value.as_str().to_owned())
        };
        headers.push(header("X-Echo", "yes")?);
        headers.push(header("Set-Cookie", "echoed=1; Path=/")?);
        json!({ "nimbo": value("X-Nimbo"), "cookie": value("Cookie"), "host": value("Host") })
            .to_string()
            .into_bytes()
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let result = page.evaluate(&format!(
            "(()=>{{globalThis.variant={variant};return {};}})()",
            include_str!("fixtures/binary-fetch.txt")
        ))?;
        let fields = result.as_object().ok_or("missing binary result")?;
        assert_eq!(fields.len(), 31);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
}

fn is_resource(path: &str) -> bool {
    if matches!(path, "/stealth" | "/stealth-echo") {
        return true;
    }
    if is_cookie_resource(path) {
        return true;
    }
    is_dom_resource(path)
        || is_script_resource(path)
        || [
            "/sheets-css/",
            "/layout-budget/",
            "/logical-size/",
            "/contextual-box-lengths/",
            "/resolved-box-values/",
            "/svg-viewport/",
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
            "/text-layout/",
            "/font-profile/",
            "/order-layout/",
            "/anonymous-text/",
            "/authored-button/",
            "/font-settings/",
            "/text-baseline/",
            "/atomic-inline/",
            "/rounded-box/",
            "/clip-geometry/",
            "/positioned-generated/",
            "/text-transform/",
            "/adjacent-element/",
            "/logical-borders/",
            "/explicit-grid/",
            "/paragraph-wrap/",
            "/headings/",
            "/translation/",
            "/canvas-box/",
            "/box-shadow-geometry/",
            "/public-font-assets/",
            "/font-shaping/",
            "/font-shaping-assets/",
            "/font-scripts/",
            "/font-scripts-assets/",
            "/font-fallback/",
            "/font-fallback-assets/",
        ]
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

fn serve_public_font(request: Request, name: &str) -> io::Result<()> {
    let allowed = ["Serif", "Sans", "Mono"].iter().any(|family| {
        ["Regular", "Bold", "Italic", "BoldItalic"]
            .iter()
            .any(|style| name == format!("Liberation{family}-{style}.ttf"))
    });
    if !allowed {
        return request.respond(Response::from_data("missing").with_status_code(404));
    }
    let bytes = std::fs::read(
        std::path::Path::new(env!("OUT_DIR"))
            .join("fonts")
            .join(name),
    )?;
    request.respond(Response::from_data(bytes).with_header(header("Content-Type", "font/ttf")?))
}

fn serve_rounded_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/rounded-box.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_clip_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/clip-geometry.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_positioned_generated_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/positioned-generated.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_text_transform_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/text-transform.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_adjacent_element_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/adjacent-element.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_canvas_box_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/canvas-box.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_translation_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/translation.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_headings_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/headings.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_paragraph_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/paragraph-wrap.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_grid_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/explicit-grid.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_logical_borders_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/logical-borders.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_box_shadow_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/box-shadow-geometry.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_atomic_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/atomic-inline.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_baseline_fixture(request: Request, variant: &str) -> io::Result<()> {
    let variant = variant.parse::<usize>().unwrap_or_default();
    request.respond(Response::from_data(format!(
        "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
        include_str!("fixtures/text-baseline.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

fn serve_fonts(request: Request) -> io::Result<()> {
    let path = request.url().to_owned();
    if let Some(name) = path.strip_prefix("/public-font-assets/") {
        return serve_public_font(request, name);
    }
    if let Some(variant) = path.strip_prefix("/text-baseline/") {
        return serve_baseline_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/atomic-inline/") {
        return serve_atomic_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/clip-geometry/") {
        return serve_clip_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/canvas-box/") {
        return serve_canvas_box_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/translation/") {
        return serve_translation_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/headings/") {
        return serve_headings_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/paragraph-wrap/") {
        return serve_paragraph_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/explicit-grid/") {
        return serve_grid_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/logical-borders/") {
        return serve_logical_borders_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/box-shadow-geometry/") {
        return serve_box_shadow_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/adjacent-element/") {
        return serve_adjacent_element_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/text-transform/") {
        return serve_text_transform_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/positioned-generated/") {
        return serve_positioned_generated_fixture(request, variant);
    }
    if let Some(variant) = path.strip_prefix("/rounded-box/") {
        return serve_rounded_fixture(request, variant);
    }
    serve_font_response(request, &path)
}

/// Multi-script and fallback font fixtures share the synthetic font assets.
fn script_font_response(path: &str) -> io::Result<Option<Response<io::Cursor<Vec<u8>>>>> {
    let response = if path.starts_with("/font-fallback-assets/latin/") {
        Response::from_data(include_bytes!("fixtures/synthetic-shaping-font.ttf").to_vec())
            .with_header(header("Content-Type", "font/ttf")?)
    } else if path.starts_with("/font-fallback-assets/scripts/") {
        Response::from_data(include_bytes!("fixtures/synthetic-scripts-font.ttf").to_vec())
            .with_header(header("Content-Type", "font/ttf")?)
    } else if let Some(variant) = path.strip_prefix("/font-fallback/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/font-fallback.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if path.starts_with("/font-scripts-assets/") {
        Response::from_data(include_bytes!("fixtures/synthetic-scripts-font.ttf").to_vec())
            .with_header(header("Content-Type", "font/ttf")?)
    } else if let Some(variant) = path.strip_prefix("/font-scripts/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/font-scripts.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else {
        return Ok(None);
    };
    Ok(Some(response))
}

fn serve_font_response(request: Request, path: &str) -> io::Result<()> {
    if let Some(response) = script_font_response(path)? {
        return request.respond(response);
    }
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
    } else if path.starts_with("/font-shaping-assets/") {
        Response::from_data(include_bytes!("fixtures/synthetic-shaping-font.ttf").to_vec())
            .with_header(header("Content-Type", "font/ttf")?)
    } else if let Some(variant) = path.strip_prefix("/font-settings/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/font-settings.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/authored-button/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/authored-button.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/anonymous-text/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/anonymous-text.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/order-layout/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><body><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/order-layout.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/font-profile/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/font-profile.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/text-layout/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/text-layout.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
    } else if let Some(variant) = path.strip_prefix("/font-shaping/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        Response::from_data(format!(
            "<!doctype html><meta charset=utf-8><script>globalThis.variant={variant};{}</script>",
            include_str!("fixtures/font-shaping.txt")
        ))
        .with_header(header("Content-Type", "text/html")?)
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-loading/{variant}")))?;
        let result = page.evaluate(&format!("fontCase({variant})"))?;
        let fields = result.as_object().ok_or("missing font result")?;
        assert_eq!(fields.len(), 27);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn font_matching_selects_and_loads_real_http_fonts() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-matching/{variant}")))?;
        let result = page.evaluate(&format!("fontMatchCase({variant})"))?;
        let fields = result.as_object().ok_or("missing font matching result")?;
        assert_eq!(fields.len(), 55);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/borders/{variant}")))?;
        let result = page.evaluate(&format!("borderCase({variant})"))?;
        let fields = result.as_object().ok_or("missing border result")?;
        assert_eq!(fields.len(), 54);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/canvas/{variant}")))?;
        let result = page.evaluate(&format!("canvasCase({variant})"))?;
        let fields = result.as_object().ok_or("missing canvas result")?;
        assert_eq!(fields.len(), 55);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn software_canvas_uploads_real_http_pixels() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/canvas/{variant}")))?;
        let result = page.evaluate(&format!("canvasUploadCase({variant})"))?;
        let fields = result.as_object().ok_or("missing canvas upload result")?;
        assert_eq!(fields.len(), 30);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn software_canvas_composites_real_http_pixels() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
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
    for (budget, accepted) in [(1104, false), (1105, true)] {
        let browser = Browser::new(
            &fixture.url,
            Limits {
                max_layout_nodes: budget,
                ..Limits::default()
            },
        )?;
        let page = browser.navigate(&fixture.path("/layout-budget/0"))?;
        let result = page.evaluate("layoutBudgetCase(0)");
        if accepted {
            assert!(
                result?
                    .as_object()
                    .ok_or("missing boundary checks")?
                    .values()
                    .all(|value| value == &json!(true))
            );
        } else {
            assert!(result.is_err_and(|error| error.to_string().contains("layout tree: nodes")));
        }
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
}

#[test]
fn computed_outlines_real_http_live_styles() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/text-adjust/{variant}")))?;
        let result = page.evaluate(&format!("textAdjustCase({variant})"))?;
        let fields = result.as_object().ok_or("missing text adjustment result")?;
        assert_eq!(fields.len(), 44);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/tabs/{variant}")))?;
        let result = page.evaluate(&format!("tabsCase({variant})"))?;
        let fields = result.as_object().ok_or("missing computed tabs result")?;
        assert_eq!(fields.len(), 46);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/line-height/{variant}")))?;
        let result = page.evaluate(&format!("lineHeightCase({variant})"))?;
        let fields = result.as_object().ok_or("missing line height result")?;
        assert_eq!(fields.len(), 51);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/background-size/{variant}")))?;
        let result = page.evaluate(&format!("backgroundSizeCase({variant})"))?;
        let fields = result.as_object().ok_or("missing background size result")?;
        assert_eq!(fields.len(), 71);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-family/{variant}")))?;
        let result = page.evaluate(&format!("fontFamilyCase({variant})"))?;
        let fields = result.as_object().ok_or("missing font family result")?;
        assert_eq!(fields.len(), 75);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/display/{variant}")))?;
        let result = page.evaluate(&format!("displayCase({variant})"))?;
        let fields = result.as_object().ok_or("missing display result")?;
        assert_eq!(fields.len(), 105);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        for group in 0..4 {
            let page = browser.navigate(&fixture.path(&format!("/html-boxes/{variant}")))?;
            let result = page.evaluate(&format!("htmlBoxesCase({variant},{group})"))?;
            let fields = result.as_object().ok_or("missing HTML box result")?;
            assert_eq!(fields.len(), if group == 3 { 24 } else { 51 });
            assert!(
                fields.values().all(|value| *value == json!(true)),
                "variant {variant}, group {group}: {result}"
            );
        }
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
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
        Ok(())
    })
}

#[test]
fn native_adopted_stylesheets_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/adopted-sheets/{variant}")))?;
        let result = page.evaluate(&format!("adoptedSheetsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing adoption checks")?;
        assert_eq!(checks.len(), 36);
        assert!(
            checks.values().all(|check| *check == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn live_children_counts_and_mutations_fit_default_budgets() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/large-dom/live-children"))?;
    let result = page.evaluate("largeLiveChildrenCase()")?;
    let checks = result.as_object().ok_or("missing collection checks")?;
    assert_eq!(checks.len(), 8);
    assert!(
        checks.values().all(|check| *check == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn diagnostics_observe_owned_heap_and_counters_without_resetting_budgets() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let before = page.diagnostics();
    assert_eq!(page.execution_phase(), nimbo_engine::ExecutionPhase::Ready);
    assert_eq!(page.execution_phase().as_str(), "ready");
    assert_eq!(page.diagnostics(), before);
    page.evaluate("(globalThis.kept=Array.from({length:1000},(_,i)=>({i})),document.body.setAttribute('data-marker','owned'),true)")?;
    let after = page.diagnostics();
    assert!(after.javascript_used_bytes > before.javascript_used_bytes);
    assert!(after.javascript_object_count > before.javascript_object_count);
    assert!(after.dom_operations > before.dom_operations);
    assert!(after.dom_write_bytes > before.dom_write_bytes);
    assert!(after.javascript_ticks_used >= before.javascript_ticks_used);
    assert!(after.microtasks_executed > before.microtasks_executed);
    assert_eq!(page.diagnostics(), after);
    let fresh = browser.navigate(&fixture.path("/static"))?;
    assert!(fresh.diagnostics().javascript_used_bytes < after.javascript_used_bytes);
    assert_eq!(fresh.evaluate("typeof kept")?, json!("undefined"));
    Ok(())
}

#[test]
fn live_collection_iterations_observe_native_mutation_versions() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/large-dom/iteration"))?;
    let result = page.evaluate("collectionIterationCase()")?;
    let checks = result.as_object().ok_or("missing iteration checks")?;
    assert_eq!(checks.len(), 11);
    assert!(
        checks.values().all(|check| *check == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn initial_dom_node_limits_reject_before_scripts_and_recover_over_http() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_initial_dom_nodes: 5000,
            ..Limits::default()
        },
    )?;
    assert!(matches!(
        browser.navigate(&fixture.path("/large-dom/limited")),
        Err(Error::Limit("initial DOM nodes"))
    ));
    let fresh = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(fresh.evaluate("typeof largeDomCase")?, json!("undefined"));
    assert!(matches!(
        Browser::new(
            &fixture.url,
            Limits {
                max_initial_dom_nodes: 0,
                ..Limits::default()
            }
        ),
        Err(Error::Limit("invalid configuration"))
    ));
    Ok(())
}

#[test]
fn control_selector_queries_and_styles_follow_owned_state() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let source = include_str!("fixtures/control-selectors.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=controlSelectorsCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?,json!({"count":44,"failed":[]}));
    Ok(())
}

#[test]
fn attribute_presence_preserves_namespace_case_and_receiver_contracts() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/attribute-presence.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};const checks=attributePresenceCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"
        ))?,
        json!({"count":24,"failed":[]})
    );
    Ok(())
}

#[test]
fn form_owners_follow_native_tree_and_attribute_mutations() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/form-ownership.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};const checks=formOwnershipCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"
        ))?,
        json!({"count":23,"failed":[]})
    );
    Ok(())
}

#[test]
fn form_reset_restores_owned_state_after_cancellable_events() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/form-reset.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};const checks=formResetCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"
        ))?,
        json!({"count":26,"failed":[]})
    );
    Ok(())
}

#[test]
fn reset_buttons_activate_owned_form_algorithms_after_click_delivery() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/reset-buttons.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};const checks=resetButtonsCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"
        ))?,
        json!({"count":42,"failed":[]})
    );
    Ok(())
}

#[test]
fn input_activation_delivers_and_cancels_owned_state_over_http() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/input-activation.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=inputActivationCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?,json!({"count":36,"failed":[]}));
    let bounded = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 26,
            ..Limits::default()
        },
    )?;
    let page = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(()=>{globalThis.control=document.createElement('input');control.type='checkbox';control.indeterminate=true;let events=0;control.addEventListener('click',()=>events++);let failed=false;try{control.click()}catch(e){failed=e.message.includes('resource limit: DOM write bytes')}return failed&&!control.checked&&control.indeterminate&&events===0})()")?,json!(true));
    let fresh = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(fresh.evaluate("typeof control")?, json!("undefined"));
    Ok(())
}

#[test]
fn mouse_and_pointer_events_follow_owned_constructor_contracts() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/mouse-events.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};const checks=mouseEventsCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"
        ))?,
        json!({"count":46,"failed":[]})
    );
    Ok(())
}

#[test]
fn input_checkedness_owns_dirty_state_and_enforces_write_budgets() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/input-checkedness.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};return Object.values(inputCheckednessCase(0)).every(Boolean)}})()"
        ))?,
        json!(true)
    );
    let bounded = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 6,
            ..Limits::default()
        },
    )?;
    let page = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(()=>{globalThis.control=document.createElement('input');control.checked=true;let failed=false;try{control.checked=false}catch(e){failed=e.message.includes('resource limit: DOM write bytes')}return failed&&control.checked&&!control.defaultChecked})()")?, json!(true));
    let fresh = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(
        fresh.evaluate(
            "({previous:typeof control,checked:document.createElement('input').checked})"
        )?,
        json!({"previous":"undefined","checked":false})
    );
    Ok(())
}

#[test]
fn input_default_value_modes_transfer_state_and_charge_attribute_writes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/input-value-modes.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};return Object.values(inputValueModesCase(0)).every(Boolean)}})()"
        ))?,
        json!(true)
    );
    let bounded = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 32,
            ..Limits::default()
        },
    )?;
    let page = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(()=>{globalThis.control=document.createElement('input');control.type='hidden';control.value='ok';let failed=false;try{control.value='x'.repeat(40)}catch(e){failed=e.message.includes('resource limit: DOM write bytes')}return failed&&control.value==='ok'&&control.defaultValue==='ok'&&control.getAttribute('value')==='ok'})()")?, json!(true));
    let fresh = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(
        fresh
            .evaluate("({previous:typeof control,value:document.createElement('input').value})")?,
        json!({"previous":"undefined","value":""})
    );
    Ok(())
}

#[test]
fn text_controls_follow_native_state_and_enforce_write_budgets() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/text-controls.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};return Object.values(textControlsCase(0)).every(Boolean)}})()"
        ))?,
        json!(true)
    );
    let bounded = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 32,
            ..Limits::default()
        },
    )?;
    let page = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(()=>{globalThis.input=document.createElement('input');input.value='before';let failed=false;try{input.value='x'.repeat(40)}catch(e){failed=e.message.includes('resource limit: DOM write bytes')}return {failed,value:input.value,defaultValue:input.defaultValue,attribute:input.getAttribute('value')}})()")?, json!({"failed":true,"value":"before","defaultValue":"","attribute":null}));
    let fresh = bounded.navigate(&fixture.path("/static"))?;
    assert_eq!(
        fresh.evaluate("({previous:typeof input,value:document.createElement('input').value})")?,
        json!({"previous":"undefined","value":""})
    );
    Ok(())
}

#[test]
fn attribute_counts_avoid_materializing_handles_and_remain_live() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/attribute-count.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};globalThis.countedAttributes=attributeCountSetup(4000).attributes;return true}})()"
        ))?,
        json!(true)
    );
    let before = page.diagnostics();
    assert_eq!(
        page.evaluate("(()=>{for(let i=0;i<512;i++)if(countedAttributes.length!==4000)return false;return true})()")?,
        json!(true)
    );
    let after = page.diagnostics();
    assert_eq!(after.dom_handle_count, before.dom_handle_count);
    assert_eq!(after.dom_write_bytes, before.dom_write_bytes);
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};return Object.values(attributeCountCase(0)).every(Boolean)}})()"
        ))?,
        json!(true)
    );
    Ok(())
}

#[test]
fn native_fragment_parsing_preserves_recovery_and_detached_references() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/dom-arena.txt");
    assert_eq!(
        page.evaluate(&format!(
            "(()=>{{{source};return Object.values(fragmentCase()).every(Boolean)}})()"
        ))?,
        json!(true)
    );
    Ok(())
}

#[test]
fn cumulative_dom_nodes_bound_factories_and_preserve_failed_html_writes() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_nodes: 64,
            ..Limits::default()
        },
    )?;
    let source = include_str!("fixtures/dom-arena.txt");
    for mode in [
        "element",
        "namespace",
        "text",
        "comment",
        "fragment",
        "document",
        "htmlDocument",
        "shadow",
        "textContent",
    ] {
        let page = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(
            page.evaluate(&format!(
                "(()=>{{{source};return arenaFactoryCase('{mode}')}})()"
            ))?,
            json!(true),
            "{mode}"
        );
    }
    let page = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(()=>{document.body.innerHTML='<b id=kept>old</b>';const old=document.getElementById('kept');let failed=false;try{document.body.innerHTML='<p>'.repeat(1000)}catch(e){failed=e.message.includes('resource limit: DOM nodes')}const preserved=failed&&document.getElementById('kept')===old&&old.textContent==='old';document.body.innerHTML='';return preserved&&document.body.childNodes.length===0})()")?, json!(true));
    let fresh = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(
        fresh.evaluate("document.createElement('i').tagName")?,
        json!("I")
    );
    Ok(())
}

#[test]
fn native_large_dom_js_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/large-dom/{variant}")))?;
        let expression = format!("largeDomCase({variant})");
        assert_eq!(
            page.evaluate(&expression)?,
            json!({"value":"row","changed":format!("updated-{variant}"),"count":5000,"keys":5000,"retained":true,"remaining":4999,"last":"row"})
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/custom-boxes/{variant}")))?;
        let result = page.evaluate(&format!("customBoxesCase({variant})"))?;
        let checks = result.as_object().ok_or("missing checks")?;
        assert_eq!(checks.len(), 26);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn positioned_boxes_use_containing_blocks_and_viewport() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/positioned-boxes/{variant}")))?;
        let result = page.evaluate(&format!("positionedBoxesCase({variant})"))?;
        let checks = result.as_object().ok_or("missing checks")?;
        assert_eq!(checks.len(), 25);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn namespaced_elements_preserve_native_names_and_interfaces() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/namespaced-elements/{variant}")))?;
        let result = page.evaluate(&format!("namespacedElementsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing namespace checks")?;
        assert_eq!(checks.len(), 38);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/urls/{variant}")))?;
        let result = page.evaluate(&format!("urlsCase({variant})"))?;
        let checks = result.as_object().ok_or("missing URL checks")?;
        assert_eq!(checks.len(), 42);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
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
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/sticky-geometry/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing sticky checks")?;
        assert_eq!(checks.len(), 28);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn z_index_computes_cascade_without_changing_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/z-index/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing z-index checks")?;
        assert_eq!(checks.len(), 39);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
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

#[test]
fn css_transition_sampling_accepts_completed_timelines_after_late_timer_delivery() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let source =
        include_str!("fixtures/transitions.txt").replace("await sleep(100);", "await sleep(700);");
    let checks = page.evaluate(&format!(
        "(()=>{{{source};return transitionsCase(9999)}})()"
    ))?;
    let checks = checks.as_object().ok_or("missing late transition checks")?;
    assert_eq!(checks.len(), 25);
    let failed = checks
        .iter()
        .filter(|(_, value)| **value != json!(true))
        .map(|(name, _)| name)
        .collect::<Vec<_>>();
    assert!(
        failed.is_empty(),
        "{failed:?}; {}",
        page.evaluate("globalThis.transitionDebug")?
    );
    Ok(())
}

#[test]
fn css_transitions_advance_with_real_timers() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/transitions/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing transition checks")?;
        assert_eq!(checks.len(), 25);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}; {}",
            page.evaluate("globalThis.transitionDebug")?
        );
        Ok(())
    })
}

fn serve_transitions(request: Request) -> io::Result<()> {
    if let Some(variant) = request.url().strip_prefix("/transitions/") {
        let variant = variant.parse::<usize>().unwrap_or_default();
        return request.respond(Response::from_string(format!(
            "<!doctype html><body><script>{}\nglobalThis.comparison=transitionsCase({variant})</script>",
            include_str!("fixtures/transitions.txt")
        )).with_header(header("Content-Type", "text/html")?));
    }
    request.respond(Response::empty(404))
}

fn serve_logical_spacing(request: Request) -> io::Result<()> {
    if request.url() == "/logical-spacing-style" {
        return request.respond(
            Response::from_string(
                "#external{margin-inline-start:17px!important;padding-block-end:9px}",
            )
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    let timed = request.url().starts_with("/logical-spacing-transitions/");
    let function = if timed {
        "logicalSpacingTransitionsCase"
    } else {
        "logicalSpacingCase"
    };
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_default();
    request.respond(Response::from_string(format!(
        "<!doctype html><link rel=\"stylesheet\" href=\"/logical-spacing-style\"><body><script>{}\nglobalThis.comparison={function}({variant})</script>",
        include_str!("fixtures/logical-spacing.txt")
    )).with_header(header("Content-Type", "text/html")?))
}
#[test]
fn logical_spacing_maps_cascade_to_real_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    for (route, count) in [("logical-spacing", 45), ("logical-spacing-transitions", 11)] {
        each_variant(&fixture, |browser, variant| {
            let page = browser.navigate(&fixture.path(&format!("/{route}/{variant}")))?;
            let result = page.evaluate("globalThis.comparison")?;
            let checks = result.as_object().ok_or("missing logical spacing checks")?;
            assert_eq!(checks.len(), count);
            assert!(
                checks.values().all(|value| value == &json!(true)),
                "{result}"
            );
            Ok(())
        })?;
    }
    Ok(())
}

fn serve_logical_size(request: Request) -> io::Result<()> {
    request.respond(
        Response::from_string(format!(
            "<!doctype html><meta charset=utf-8><script>{}</script>",
            include_str!("fixtures/logical-size.txt")
        ))
        .with_header(header("Content-Type", "text/html")?),
    )
}

fn serve_contextual_box_lengths(request: Request) -> io::Result<()> {
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(io::Error::other)?;
    request.respond(Response::from_string(format!(
        "<!doctype html><body><script>{}\nglobalThis.comparison=contextualBoxLengthsCase({variant})</script>",
        include_str!("fixtures/contextual-box-lengths.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn contextual_box_lengths_resolve_native_fonts_and_viewport() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page =
            browser.navigate(&fixture.path(&format!("/contextual-box-lengths/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result
            .as_object()
            .ok_or("missing contextual length checks")?;
        assert_eq!(checks.len(), 50);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn contextual_box_lengths_follow_configured_media() -> TestResult {
    let fixture = Fixture::new()?;
    for variant in 0_u32..64 {
        let media = MediaEnvironment {
            width: 321 + variant * 8,
            height: 217 + variant * 7,
            default_font_size: u16::try_from(10 + variant % 16)?,
            ..MediaEnvironment::default()
        };
        let browser = Browser::with_media(&fixture.url, Limits::default(), media.clone())?;
        let page = browser.navigate(&fixture.path("/contextual-box-lengths/0"))?;
        let expression = format!(
            "(()=>{{document.documentElement.style.fontSize='initial';document.body.style.fontSize='inherit';const box=document.createElement('div');box.style.cssText='width:2rem;height:10vh';document.body.append(box);const rect=box.getBoundingClientRect();return Math.abs(rect.width-{})<.01&&Math.abs(rect.height-{})<.01&&innerWidth==={}&&innerHeight==={}&&getComputedStyle(document.documentElement).fontSize==='{}px'}})()",
            media.default_font_size * 2,
            f64::from(media.height) / 10.0,
            media.width,
            media.height,
            media.default_font_size,
        );
        assert_eq!(page.evaluate(&expression)?, json!(true));
    }
    Ok(())
}

fn serve_resolved_box_values(request: Request) -> io::Result<()> {
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(io::Error::other)?;
    request.respond(Response::from_string(format!(
        "<!doctype html><body><script>{}\nglobalThis.comparison=resolvedBoxValuesCase({variant})</script>",
        include_str!("fixtures/resolved-box-values.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn resolved_box_values_follow_native_used_layout() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/resolved-box-values/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing resolved box checks")?;
        assert_eq!(checks.len(), 37);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

fn serve_svg_viewport(request: Request) -> io::Result<()> {
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(io::Error::other)?;
    request.respond(Response::from_string(format!(
        "<!doctype html><body><script>{}\nglobalThis.comparison=svgViewportCase({variant})</script>",
        include_str!("fixtures/svg-viewport.txt")
    )).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn svg_viewports_use_native_intrinsic_sizing() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/svg-viewport/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing SVG viewport checks")?;
        assert_eq!(checks.len(), 39);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

fn is_script_resource(path: &str) -> bool {
    [
        "/script-modes/",
        "/script-modes-assets/",
        "/animation-frames/",
        "/layout-snapshot/",
        "/background-color/",
        "/document-stylesheets/",
        "/window-named/",
        "/attribute-namespaces/",
        "/document-stylesheets-assets/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
}

fn serve_named_contracts(request: Request) -> io::Result<()> {
    for (route, source, function) in [
        (
            "/attribute-namespaces/",
            include_str!("fixtures/attribute-namespaces.txt"),
            "attributeNamespacesCase",
        ),
        (
            "/window-named/",
            include_str!("fixtures/window-named.txt"),
            "windowNamedCase",
        ),
    ] {
        if request.url().starts_with(route) {
            let variant = request
                .url()
                .rsplit('/')
                .next()
                .unwrap_or("0")
                .parse::<usize>()
                .map_err(io::Error::other)?;
            return request.respond(Response::from_string(format!("<!doctype html><body><script>{source};globalThis.comparison={function}({variant})</script>")).with_header(header("Content-Type", "text/html")?));
        }
    }
    request.respond(Response::from_string("Not found").with_status_code(404))
}

fn serve_scripts(request: Request) -> io::Result<()> {
    if ["/attribute-namespaces/", "/window-named/"]
        .iter()
        .any(|route| request.url().starts_with(route))
    {
        return serve_named_contracts(request);
    }
    if request.url() == "/document-stylesheets-assets/missing.css" {
        return request.respond(
            Response::from_string("Missing")
                .with_status_code(404)
                .with_header(header("Content-Type", "text/css")?),
        );
    }
    if request.url() == "/document-stylesheets-assets/wrong-mime.css" {
        return request.respond(
            Response::from_string("#box { width: 999px }")
                .with_header(header("Content-Type", "text/plain")?)
                .with_header(header("X-Content-Type-Options", "nosniff")?),
        );
    }
    if request.url().starts_with("/document-stylesheets-assets/") {
        let variant = request
            .url()
            .rsplit('/')
            .next()
            .unwrap_or("0.css")
            .trim_end_matches(".css")
            .parse::<usize>()
            .map_err(io::Error::other)?;
        return request.respond(
            Response::from_string(format!(
                "#box {{ width: {}px }}",
                30_usize.saturating_add(variant)
            ))
            .with_header(header("Content-Type", "text/css")?),
        );
    }
    if request.url().starts_with("/document-stylesheets/") {
        let variant = request
            .url()
            .rsplit('/')
            .next()
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(io::Error::other)?;
        let source = include_str!("fixtures/document-stylesheets.txt");
        return request.respond(Response::from_string(format!("<!doctype html><head><style id=inline>#box {{ width:20px }}</style><link id=external rel=stylesheet href=/document-stylesheets-assets/{variant}.css><link id=failed rel=stylesheet href=/document-stylesheets-assets/missing.css><link id=wrong-mime rel=stylesheet href=/document-stylesheets-assets/wrong-mime.css><link id=reference rel=help href=https://example.com></head><body><div id=box></div><script>{source};globalThis.comparison=documentStylesheetsCase({variant})</script>")).with_header(header("Content-Type", "text/html")?));
    }
    if request.url().starts_with("/background-color/") {
        let variant = request
            .url()
            .rsplit('/')
            .next()
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(io::Error::other)?;
        let source = include_str!("fixtures/background-color.txt");
        return request.respond(Response::from_string(format!("<!doctype html><body><script>{source};globalThis.comparison=backgroundColorCase({variant})</script>")).with_header(header("Content-Type", "text/html")?));
    }
    if request.url().starts_with("/layout-snapshot/") {
        return serve_layout_snapshot(request);
    }
    if request.url().starts_with("/animation-frames/") {
        return serve_animation_frames(request);
    }
    let path = request.url();
    let (body, mime) = if path == "/script-modes-assets/classic.js" {
        ("externalCreated=modeVariant+1;globalThis.externalReceiver=(function(){return this})();".to_owned(), "text/javascript")
    } else if path == "/script-modes-assets/module.mjs" {
        (
            include_str!("fixtures/script-modes-module.txt").to_owned(),
            "text/javascript",
        )
    } else {
        let variant = path
            .rsplit('/')
            .next()
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(io::Error::other)?;
        (
            include_str!("fixtures/script-modes-html.txt")
                .replace("__VARIANT__", &variant.to_string())
                .replace("__CASE_SOURCE__", include_str!("fixtures/script-modes.txt")),
            "text/html",
        )
    };
    request.respond(Response::from_string(body).with_header(header("Content-Type", mime)?))
}

#[test]
fn classic_scripts_and_expressions_preserve_ecmascript_modes() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/script-modes/{variant}")))?;
        let result = page.evaluate(include_str!("fixtures/script-modes-expression.txt"))?;
        let checks = result.as_object().ok_or("missing script mode checks")?;
        assert_eq!(checks.len(), 37);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

fn serve_animation_frames(request: Request) -> io::Result<()> {
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(io::Error::other)?;
    let source = include_str!("fixtures/animation-frames.txt");
    request.respond(Response::from_string(format!(
        "<!doctype html><div id=\"value\">initial</div><script>const variant={variant};{source}</script>"
    )).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn animation_frames_snapshot_callbacks_and_interleave_microtasks() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let start = Instant::now();
        let page = browser.navigate(&fixture.path(&format!("/animation-frames/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing animation frame checks")?;
        assert_eq!(checks.len(), 32);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        assert!(start.elapsed() >= Duration::from_millis(30));
        Ok(())
    })
}

#[test]
fn animation_frames_share_capacity_and_execution_budgets_with_timers() -> TestResult {
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
        matches!(page.evaluate("(() => {setTimeout(() => {}, 1000);requestAnimationFrame(() => {});requestAnimationFrame(() => {});})()"), Err(Error::JavaScript(message)) if message.contains("animation frame capacity limit"))
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
        matches!(page.evaluate("new Promise(() => {function tick(){requestAnimationFrame(tick)}requestAnimationFrame(tick)})"), Err(Error::JavaScript(message)) if message.contains("timer task limit"))
    );
    Ok(())
}

fn serve_layout_snapshot(request: Request) -> io::Result<()> {
    let variant = request
        .url()
        .rsplit('/')
        .next()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(io::Error::other)?;
    let source = include_str!("fixtures/layout-snapshot.txt");
    request.respond(Response::from_string(format!("<!doctype html><body><script>{source};globalThis.comparison=layoutSnapshotCase({variant})</script>")).with_header(header("Content-Type", "text/html")?))
}

#[test]
fn layout_snapshots_observe_dom_cssom_and_scroll_mutations() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/layout-snapshot/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing layout snapshot checks")?;
        assert_eq!(checks.len(), 30);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn stylesheet_replacement_locks_and_owner_identity() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate(r"(async () => {
          document.body.innerHTML='<style>div { width: 20px }</style>';
          const owner=document.body.firstElementChild, owned=owner.sheet;
          const sheet=new CSSStyleSheet();sheet.replaceSync('div { width: 30px }');
          const old=sheet.cssRules[0], list=sheet.cssRules;
          const pending=sheet.replace('div { width: 40px }');
          const rejects=fn=>{try{fn();return false}catch(error){return error.name==='NotAllowedError'}};
          const locked=rejects(()=>sheet.replaceSync('div { width: 50px }'))&&rejects(()=>sheet.insertRule('p {}',0))&&rejects(()=>sheet.deleteRule(0));
          const settled=await pending;
          let oversized=false;try{await sheet.replace(' '.repeat(65537))}catch(error){oversized=String(error).includes('CSSOM input')}
          sheet.replaceSync('div { width: 40px }');
          const rejected=rejects(()=>owned.replaceSync('div { width: 60px }'));
          let asyncRejected=false;try{await owned.replace('div {}')}catch(error){asyncRejected=error.name==='NotAllowedError'}
          return {identity:owner.sheet===owned&&owned.ownerNode===owner,locked,settled:settled===sheet,
            detached:old.parentStyleSheet===null,live:sheet.cssRules===list&&list[0].style.width==='40px',oversized,rejected,asyncRejected};
        })()")?,
        json!({"identity":true,"locked":true,"settled":true,"detached":true,"live":true,"oversized":true,"rejected":true,"asyncRejected":true})
    );
    Ok(())
}

#[test]
fn layout_snapshot_reuse_retains_operation_limits_and_unsupported_errors() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_operations: 500,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate(r#"(() => { document.body.innerHTML='<div style="width:80px;height:20px"></div>'; const box=document.body.firstElementChild; return Array.from({length:200},()=>box.getBoundingClientRect().width).every(width=>width===80); })()"#)?,json!(true));
    let error = page.evaluate("(() => {const box=document.body.firstElementChild;for(let i=0;i<600;i++)box.getBoundingClientRect();return true})()").err().ok_or("repeated cached reads must retain the operation budget")?;
    assert!(error.to_string().contains("DOM operations"), "{error}");
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate(r#"(() => {document.body.innerHTML='<div style="width:80px;height:20px"></div>';const box=document.body.firstElementChild;const before=box.getBoundingClientRect().width;box.style.transform='rotate(10deg)';let rejected=false;try{box.getBoundingClientRect()}catch(error){rejected=String(error).includes('transform')}box.style.transform='';return {before,rejected,after:box.getBoundingClientRect().width}})()"#)?,json!({"before":80,"rejected":true,"after":80}));
    Ok(())
}

#[test]
fn background_colors_compute_native_cascade_and_live_mutations() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/background-color/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result
            .as_object()
            .ok_or("missing background color checks")?;
        assert_eq!(checks.len(), 24);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn document_stylesheets_real_http_and_live_cssom() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/document-stylesheets/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing stylesheet checks")?;
        assert_eq!(checks.len(), 25);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn grouped_sheet_metadata_does_not_parse_unsupported_cssom_rules() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate(r"(() => {
        document.body.innerHTML='<style>@media screen { div { width: 9px } }</style><div></div>';
        const owner=document.body.firstElementChild, sheet=owner.sheet;
        const rejects=()=>{try{sheet.cssRules.length;return false}catch(error){return String(error).includes('CSSOM grouping and at-rules')}};
        const first=rejects(), second=rejects();
        return {first,second,metadata:sheet.ownerNode===owner&&sheet.href===null&&sheet.type==='text/css',
          identity:owner.sheet===sheet&&document.styleSheets[0]===sheet,
          cascade:getComputedStyle(document.body.lastElementChild).width==='9px'};
    })()")?,json!({"first":true,"second":true,"metadata":true,"identity":true,"cascade":true}));
    Ok(())
}

#[test]
fn tag_collection_reads_fit_the_default_operation_budget() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate(include_str!("fixtures/tag-collection-budget.txt"))?,
        json!(true)
    );
    Ok(())
}

#[test]
fn tag_collection_membership_tracks_native_mutations_and_adoption() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let result = page.evaluate(include_str!("fixtures/tag-collection-mutations.txt"))?;
    let checks = result.as_object().ok_or("missing tag collection checks")?;
    assert_eq!(checks.len(), 25);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn cloning_preserves_detached_identity_controls_and_documents() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let result = page.evaluate(include_str!("fixtures/clone-node.txt"))?;
    let checks = result.as_object().ok_or("missing clone checks")?;
    assert_eq!(checks.len(), 33);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn cloning_respects_cumulative_node_and_write_budgets() -> TestResult {
    let fixture = Fixture::new()?;
    for limits in [
        Limits {
            max_dom_nodes: 64,
            ..Limits::default()
        },
        Limits {
            max_dom_write_bytes: 256,
            ..Limits::default()
        },
    ] {
        let browser = Browser::new(&fixture.url, limits)?;
        let page = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(
            page.evaluate(include_str!("fixtures/clone-budget.txt"))?,
            json!(true)
        );
        let fresh = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(
            fresh.evaluate("document.createElement('div').cloneNode().nodeName")?,
            json!("DIV")
        );
    }
    Ok(())
}

#[test]
fn html_document_factory_preserves_structure_title_and_ownership() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let result = page.evaluate(include_str!("fixtures/html-document.txt"))?;
    let checks = result.as_object().ok_or("missing HTML document checks")?;
    assert_eq!(checks.len(), 17);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn html_document_factory_bounds_title_writes_and_recovers() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_write_bytes: 32,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("(()=>{const before=document.body.firstChild;let failed=false;try{document.implementation.createHTMLDocument('x'.repeat(64))}catch(error){failed=error.message.includes('resource limit: DOM write bytes')}return failed&&document.body.firstChild===before})()")?, json!(true));
    let fresh = browser.navigate(&fixture.path("/static"))?;
    assert_eq!(
        fresh.evaluate("document.implementation.createHTMLDocument().doctype.name")?,
        json!("html")
    );
    Ok(())
}

#[test]
fn document_location_uses_the_active_window_and_excludes_detached_documents() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let result = page.evaluate(include_str!("fixtures/document-location.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing document location checks")?;
    assert_eq!(checks.len(), 9);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    assert_eq!(page.evaluate("(()=>{try{document.location='https://example.test/';return false}catch(error){return error.name==='NotSupportedError'}})()")?, json!(true));
    Ok(())
}

#[test]
fn window_named_properties_follow_real_dom() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate(
            r"(() => {
        document.body.innerHTML='<div id=windowNamedProbe></div>';
        const element=document.body.firstElementChild;
        const bare=windowNamedProbe===element, property=window.windowNamedProbe===element;
        element.id='renamedProbe';
        const renamed=typeof windowNamedProbe==='undefined'&&renamedProbe===element;
        element.remove();
        return {bare,property,renamed,removed:typeof renamedProbe==='undefined'};
    })()"
        )?,
        json!({"bare":true,"property":true,"renamed":true,"removed":true})
    );
    Ok(())
}

#[test]
fn detached_mutations_preserve_window_name_index() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(
        page.evaluate(include_str!("fixtures/window-named-detached.txt"))?,
        json!(true)
    );
    Ok(())
}

#[test]
fn window_names_follow_subtree_moves_and_attribute_nodes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let result = page.evaluate(include_str!("fixtures/window-named-mutations.txt"))?;
    let checks = result.as_object().ok_or("missing Window mutation checks")?;
    assert_eq!(checks.len(), 17);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn window_named_properties_mass_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/window-named/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing Window checks")?;
        assert_eq!(checks.len(), 34);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn window_interface_brand_and_prototype_identity() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    assert_eq!(page.evaluate("({window:window instanceof Window,eventTarget:window instanceof EventTarget,tag:Object.prototype.toString.call(window),ownTag:Object.getOwnPropertyDescriptor(window,Symbol.toStringTag)?.value??null})")?,json!({"window":true,"eventTarget":true,"tag":"[object Window]","ownTag":null}));
    Ok(())
}

#[test]
fn attribute_namespaces_mass_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/attribute-namespaces/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let checks = result.as_object().ok_or("missing Window checks")?;
        assert_eq!(checks.len(), 101);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}

#[test]
fn native_shaping_uses_real_http_font_resources() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-shaping/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing font shaping result")?;
        assert_eq!(fields.len(), 27);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn native_script_runs_shape_mixed_direction_text_over_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-scripts/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing font scripts result")?;
        assert_eq!(fields.len(), 18);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn native_font_fallback_selects_faces_per_character_over_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-fallback/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing font fallback result")?;
        assert_eq!(fields.len(), 8);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn native_text_layout_uses_real_http_font_resources() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/text-layout/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing text layout result")?;
        assert_eq!(fields.len(), 12, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn public_font_profile_uses_real_http_faces_and_builtin_metrics() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-profile/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing font profile result")?;
        assert_eq!(fields.len(), 14, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn flex_grid_order_layout_uses_stable_real_box_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/order-layout/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing order layout result")?;
        assert_eq!(fields.len(), 9, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn anonymous_flex_grid_text_items_use_native_real_font_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/anonymous-text/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing anonymous text result")?;
        assert_eq!(fields.len(), 9, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn authored_flex_grid_button_geometry_uses_native_text_items() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/authored-button/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing authored button result")?;
        assert_eq!(fields.len(), 8, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn font_settings_cssom_preserves_native_validated_declarations() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/font-settings/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing font settings result")?;
        assert_eq!(fields.len(), 12, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn text_baselines_use_actual_native_font_metrics() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/text-baseline/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing baseline result")?;
        assert_eq!(fields.len(), 10, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}
#[test]
fn atomic_inline_flow_uses_native_line_boxes() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/atomic-inline/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing atomic inline result")?;
        assert_eq!(fields.len(), 10, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}
#[test]
fn rounded_boxes_keep_native_rectangular_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/rounded-box/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing rounded box result")?;
        assert_eq!(fields.len(), 6, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn clip_shapes_use_native_intersection_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/clip-geometry/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing rounded box result")?;
        assert_eq!(fields.len(), 15, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn absolute_generated_boxes_use_native_positioning_and_scroll_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/positioned-generated/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing generated box result")?;
        assert_eq!(fields.len(), 10, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn unicode_text_transform_uses_native_shaping_and_preserves_dom() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/text-transform/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing text transform result")?;
        assert_eq!(fields.len(), 13, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn adjacent_elements_use_native_insertion_adoption_and_reactions() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/adjacent-element/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result
            .as_object()
            .ok_or("missing adjacent element result")?;
        assert_eq!(fields.len(), 26, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn shadow_ink_is_excluded_from_native_layout_scroll_and_intersection() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/box-shadow-geometry/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing shadow geometry result")?;
        assert_eq!(fields.len(), 16, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn logical_borders_resolve_to_physical_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/logical-borders/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing logical borders result")?;
        assert_eq!(fields.len(), 20, "variant {variant}: {result}");
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn explicit_grid_and_authored_lists_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/explicit-grid/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing grid result")?;
        assert_eq!(fields.len(), 23);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn paragraph_and_emergency_wrap_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/paragraph-wrap/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing grid result")?;
        assert_eq!(fields.len(), 14);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn heading_defaults_and_authored_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/headings/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing grid result")?;
        assert_eq!(fields.len(), 10);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn translation_geometry_and_scrolling() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/translation/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing grid result")?;
        assert_eq!(fields.len(), 19);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn canvas_replaced_box_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path(&format!("/canvas-box/{variant}")))?;
        let result = page.evaluate("globalThis.comparison")?;
        let fields = result.as_object().ok_or("missing grid result")?;
        assert_eq!(fields.len(), 15);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
        Ok(())
    })
}

#[test]
fn navigator_and_stealth_contracts_use_real_native_http_and_fresh_prototypes() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for _ in 0..16 {
        let page = browser.navigate(&fixture.path("/stealth"))?;
        let result = page.evaluate("comparison")?;
        let fields = result.as_object().ok_or("missing stealth contracts")?;
        assert_eq!(fields.len(), 22);
        assert!(
            fields.values().all(|value| *value == json!(true)),
            "{result}"
        );
        assert_eq!(page.evaluate("fetch('/stealth-echo').then(r=>r.json()).then(r=>r.userAgent===navigator.userAgent&&httpAgent===navigator.userAgent)")?, json!(true));
        assert_eq!(page.evaluate("(()=>{Object.defineProperty(Navigator.prototype,'userAgent',{get:()=> 'poison'});return navigator.userAgent})()")?, json!("poison"));
    }
    Ok(())
}

#[test]
fn readiness_conditions_drive_delayed_timers_and_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    for condition in [
        ReadyCondition::Selector {
            selector: "#ready".into(),
        },
        ReadyCondition::Predicate {
            expression: "readinessPhase === 2".into(),
        },
        ReadyCondition::NetworkIdle { quiet_ms: 30 },
    ] {
        let page = fixture.browser()?.navigate(&fixture.path("/readiness"))?;
        page.wait_for(&Readiness {
            condition,
            timeout_ms: 1000,
            poll_interval_ms: 5,
        })?;
        assert_eq!(
            page.evaluate("document.getElementById('ready').textContent")?,
            json!("Completed")
        );
    }
    Ok(())
}

#[test]
fn readiness_network_idle_restarts_after_each_request() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/readiness"))?;
    page.wait_for(&Readiness {
        condition: ReadyCondition::NetworkIdle { quiet_ms: 30 },
        timeout_ms: 1000,
        poll_interval_ms: 5,
    })?;
    assert_eq!(
        page.evaluate("readinessPhase === 2 && performance.now() - lastRequestComplete >= 30")?,
        json!(true)
    );
    Ok(())
}

#[test]
fn readiness_reports_timeout_and_invalid_predicates() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let error = page.wait_for(&Readiness {
        condition: ReadyCondition::Selector {
            selector: ".missing".into(),
        },
        timeout_ms: 25,
        poll_interval_ms: 5,
    });
    assert!(matches!(error, Err(Error::Limit("readiness deadline"))));
    for expression in [
        "Promise.resolve(true)",
        "1",
        "(() => { throw new Error('predicate failed') })()",
    ] {
        let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
        assert!(matches!(
            page.wait_for(&Readiness {
                condition: ReadyCondition::Predicate {
                    expression: expression.into()
                },
                timeout_ms: 100,
                poll_interval_ms: 5
            }),
            Err(Error::JavaScript(_))
        ));
    }
    Ok(())
}

#[test]
fn readiness_preserves_original_deadline_and_dom_budget() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            timeout: Duration::from_millis(80),
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(matches!(
        page.wait_for(&Readiness {
            condition: ReadyCondition::NetworkIdle { quiet_ms: 200 },
            timeout_ms: 1000,
            poll_interval_ms: 5
        }),
        Err(Error::Limit("navigation deadline"))
    ));
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_dom_operations: 8,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/static"))?;
    assert!(
        page.wait_for(&Readiness {
            condition: ReadyCondition::Selector {
                selector: ".missing".into()
            },
            timeout_ms: 1000,
            poll_interval_ms: 1
        })
        .is_err()
    );
    Ok(())
}

#[test]
fn readiness_timeout_starts_at_the_native_wait_call() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    thread::sleep(Duration::from_millis(40));
    page.wait_for(&Readiness {
        condition: ReadyCondition::Selector {
            selector: "main".into(),
        },
        timeout_ms: 20,
        poll_interval_ms: 5,
    })?;
    page.wait_for(&Readiness {
        condition: ReadyCondition::Predicate {
            expression: "(function(){return this === globalThis})()".into(),
        },
        timeout_ms: 20,
        poll_interval_ms: 5,
    })?;
    Ok(())
}

#[test]
fn shadow_dom_roots_slots_events_and_lifecycle_use_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    for variant in 0..64 {
        let page = fixture
            .browser()?
            .navigate(&fixture.path(&format!("/shadow-dom/{variant}")))?;
        let result = page.evaluate("comparison")?;
        let checks = result.as_object().ok_or("missing shadow contracts")?;
        assert_eq!(checks.len(), 57);
        assert!(
            checks.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn mutation_observer_records_and_microtasks_use_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    for variant in 0..64 {
        let page = fixture
            .browser()?
            .navigate(&fixture.path(&format!("/mutation-observer/{variant}")))?;
        let result = page.evaluate("comparison")?;
        let checks = result.as_object().ok_or("missing mutation contracts")?;
        assert_eq!(checks.len(), 40);
        assert!(
            checks.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn framework_hydration_state_and_keyed_updates_use_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    for (framework, expected) in [("preact", 20), ("vue", 20), ("dom-primitives", 24)] {
        for variant in 0..64 {
            let page = fixture
                .browser()?
                .navigate(&fixture.path(&format!("/frameworks/{framework}/{variant}")))?;
            let result = page.evaluate("comparison")?;
            let checks = result.as_object().ok_or("missing framework contracts")?;
            assert_eq!(checks.len(), expected);
            assert!(
                checks.values().all(|value| *value == json!(true)),
                "{framework} variant {variant}: {result}"
            );
        }
    }
    Ok(())
}

#[test]
fn same_document_history_state_events_and_url_scope_use_real_http() -> TestResult {
    let fixture = Fixture::new()?;
    for variant in 0..64 {
        let page = fixture
            .browser()?
            .navigate(&fixture.path(&format!("/history/{variant}")))?;
        let result = page.evaluate("comparison")?;
        let checks = result.as_object().ok_or("missing history contracts")?;
        assert_eq!(checks.len(), 35);
        assert!(
            checks.values().all(|value| *value == json!(true)),
            "variant {variant}: {result}"
        );
    }
    Ok(())
}

#[test]
fn native_cancellation_interrupts_timers_javascript_and_readiness() -> TestResult {
    use nimbo_engine::CancellationToken;
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_javascript_ticks: usize::MAX,
            timeout: Duration::from_secs(2),
            ..Limits::default()
        },
    )?;
    for phase in ["timer", "javascript", "readiness"] {
        let token = CancellationToken::new();
        let page = browser.navigate_with_cancel(&fixture.path("/static"), &token)?;
        let stop = token.clone();
        let cancelling = thread::spawn(move || {
            thread::sleep(Duration::from_millis(25));
            stop.cancel();
        });
        let started = Instant::now();
        let result = match phase {
            "timer" => page
                .evaluate(
                    "(globalThis.marker=42,new Promise(resolve=>setTimeout(()=>resolve(1),60000)))",
                )
                .map(|_| ()),
            "javascript" => page
                .evaluate("(()=>{globalThis.marker=42;while(true){}})()")
                .map(|_| ()),
            _ => page.wait_for(&Readiness {
                condition: ReadyCondition::Selector {
                    selector: "#never".into(),
                },
                timeout_ms: 1000,
                poll_interval_ms: 1000,
            }),
        };
        cancelling
            .join()
            .map_err(|_panic| "cancelling thread panicked")?;
        assert!(
            matches!(result, Err(Error::Cancelled)),
            "{phase}: {result:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(token.is_cancelled());
        assert_eq!(
            page.execution_phase(),
            match phase {
                "timer" => nimbo_engine::ExecutionPhase::Evaluating,
                "readiness" => nimbo_engine::ExecutionPhase::Waiting,
                _ => nimbo_engine::ExecutionPhase::Ready,
            }
        );
        token.cancel();
        assert!(matches!(page.evaluate("1"), Err(Error::Cancelled)));
        drop(page);
        let fresh = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(fresh.evaluate("typeof marker")?, json!("undefined"));
    }
    let token = CancellationToken::new();
    token.cancel();
    assert!(matches!(
        browser.navigate_with_cancel(&fixture.path("/static"), &token),
        Err(Error::Cancelled)
    ));
    Ok(())
}

#[test]
fn option_metadata_uses_native_text_and_live_form_ownership() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/option-metadata.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=optionMetadataCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?, json!({"count":45,"failed":[]}));
    Ok(())
}

#[test]
fn select_state_preserves_defaults_mutations_collections_and_reset() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/select-state.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=selectStateCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?, json!({"count":72,"failed":[]}));
    assert_eq!(page.evaluate("(()=>{const s=document.createElement('select');s.append(new Option('A'),new Option('B'));const before=s[0],replacement=new Option('Replacement');return Reflect.defineProperty(s,'0',{value:replacement,configurable:false})===false&&s[0]===before&&Reflect.defineProperty(s.options,'0',{value:replacement,configurable:false})===false&&s[0]===before})()")?, json!(true));
    Ok(())
}

#[test]
fn named_collections_observe_conversion_before_live_resolution() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/collection-names.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=collectionNamesCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?, json!({"count":19,"failed":[]}));
    let before = page.diagnostics().dom_handle_count;
    assert_eq!(page.evaluate("(()=>{document.body.innerHTML='<select multiple id=s>'+Array.from({length:1000},(_,i)=>'<option selected id=o'+i+'>'+i+'</option>').join('')+'</select>';return document.getElementById('s').selectedOptions.namedItem('missing')===null})()")?, json!(true));
    assert!(page.diagnostics().dom_handle_count <= before + 2);
    Ok(())
}

#[test]
fn collection_receivers_keep_native_brands_and_generic_iterators() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/collection-receivers.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=collectionReceiversCase(0);return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?, json!({"count":86,"failed":[]}));
    let rejected =
        page.evaluate("(NodeList.prototype.forEach.call({length:1000000000},()=>{}),true)");
    assert!(matches!(rejected, Err(Error::Limit("JavaScript fuel"))));
    assert_eq!(
        browser
            .navigate(&fixture.path("/static"))?
            .evaluate("typeof missing")?,
        json!("undefined")
    );
    Ok(())
}

#[test]
fn collection_iteration_observes_length_and_inherited_indices() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/static"))?;
    let source = include_str!("fixtures/collection-properties.txt");
    assert_eq!(page.evaluate(&format!("(()=>{{{source};const checks=collectionPropertiesCase();return {{count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}}}})()"))?, json!({"count":38,"failed":[]}));
    Ok(())
}

#[test]
fn diagnosed_navigation_preserves_failure_stages_and_recovers() -> TestResult {
    use nimbo_engine::{CancellationToken, ExecutionPhase, NavigationStage};
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let token = CancellationToken::new();
    for (url, stage, phase) in [
        (
            "http://example.test/".to_owned(),
            NavigationStage::Request,
            None,
        ),
        (
            fixture.path("/missing-native-diagnostics"),
            NavigationStage::Response,
            None,
        ),
        (fixture.path("/api"), NavigationStage::Response, None),
        (
            fixture.path("/bad-js"),
            NavigationStage::Execution,
            Some(ExecutionPhase::Scripts),
        ),
        (
            fixture.path("/infinite"),
            NavigationStage::Execution,
            Some(ExecutionPhase::Scripts),
        ),
        (
            fixture.path("/lifecycle-infinite"),
            NavigationStage::Execution,
            Some(ExecutionPhase::Lifecycle),
        ),
    ] {
        let failure = browser
            .navigate_with_diagnostics(&url, &token)
            .err()
            .ok_or("navigation unexpectedly succeeded")?;
        assert_eq!(failure.stage, stage, "{failure:?}");
        assert_eq!(failure.execution_phase, phase, "{failure:?}");
        assert!(std::error::Error::source(&failure).is_some());
        let page = browser.navigate_with_diagnostics(&fixture.path("/static"), &token)?;
        assert_eq!(page.execution_phase(), ExecutionPhase::Ready);
    }
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let failure = browser
        .navigate_with_diagnostics(&fixture.path("/static"), &cancelled)
        .err()
        .ok_or("cancelled navigation succeeded")?;
    assert_eq!(failure.stage, NavigationStage::Validation);
    assert_eq!(failure.execution_phase, None);
    assert!(matches!(failure.error, Error::Cancelled));
    let bounded = Browser::new(
        &fixture.url,
        Limits {
            max_initial_dom_nodes: 5,
            ..Limits::default()
        },
    )?;
    let failure = bounded
        .navigate_with_diagnostics(&fixture.path("/static"), &token)
        .err()
        .ok_or("dense navigation succeeded")?;
    assert_eq!(failure.stage, NavigationStage::Initialization);
    assert_eq!(failure.execution_phase, None);
    assert!(matches!(failure.error, Error::Limit("initial DOM nodes")));
    let fresh = bounded.navigate_with_diagnostics(&fixture.path("/empty-layout"), &token)?;
    assert_eq!(fresh.execution_phase(), ExecutionPhase::Ready);
    Ok(())
}

#[test]
fn blocked_stylesheets_report_errors_and_recover_without_leaving_the_origin() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let result = page.evaluate(include_str!("fixtures/stylesheet-origin-policy.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing stylesheet policy checks")?;
    assert_eq!(checks.len(), 6);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn console_logs_during_page_execution_and_keeps_native_records() -> TestResult {
    use nimbo_engine::ConsoleLevel::{Assert, Debug, Error, Info, Log, Warn};
    let fixture = Fixture::new()?;
    let page = fixture.browser()?.navigate(&fixture.path("/static"))?;
    let checks = page.evaluate(include_str!("fixtures/console.txt"))?;
    let checks = checks.as_object().ok_or("missing console checks")?;
    assert_eq!(checks.len(), 11);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{checks:?}"
    );
    let messages = page.console_messages();
    let actual: Vec<_> = messages
        .iter()
        .map(|message| (message.level, message.text.as_str()))
        .collect();
    assert_eq!(
        actual,
        vec![
            (Debug, "debug"),
            (Info, "info"),
            (Warn, "warn"),
            (Error, "error"),
            (Log, " 1"),
            (Log, "value:12.5x/12/12.5/[Object]/[Object]/end"),
            (Assert, "Assertion failed"),
            (Assert, "Assertion failed: detail"),
            (Log, "detached"),
            (Log, "[Object]"),
            (Log, "safe 10 2.5"),
            (Log, "Symbol(s)/NaN/NaN"),
            (Info, "nested"),
            (Log, "outer"),
        ]
    );
    Ok(())
}

#[test]
fn console_buffers_bound_utf8_records_and_reset_for_fresh_pages() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    let page = browser.navigate(&fixture.path("/static"))?;
    page.evaluate("(()=>{for(var i=0;i<120;i++)console.log('entry',i)})()")?;
    let messages = page.console_messages();
    assert_eq!(messages.len(), 100);
    assert_eq!(
        messages.first().map(|entry| entry.text.as_str()),
        Some("entry 20")
    );
    assert_eq!(
        messages.last().map(|entry| entry.text.as_str()),
        Some("entry 119")
    );
    page.evaluate(
        "(()=>{console.clear();for(var i=0;i<20;i++)console.log('%s','€'.repeat(2000))})()",
    )?;
    let messages = page.console_messages();
    assert_eq!(messages.len(), 16);
    assert!(messages.iter().all(|entry| entry.text.len() == 4095));
    assert_eq!(
        messages.iter().map(|entry| entry.text.len()).sum::<usize>(),
        65_520
    );
    page.evaluate("(()=>{console.clear();console.log('kept')})()")?;
    assert_eq!(page.console_messages().len(), 1);
    assert_eq!(messages.len(), 16);
    page.evaluate(r"(()=>{console.clear();console.log('\ud800','\udc00','\ud800\udc00')})()")?;
    assert_eq!(
        page.console_messages()
            .first()
            .map(|entry| entry.text.as_str()),
        Some("\u{fffd} \u{fffd} \u{10000}")
    );
    let fresh = browser.navigate(&fixture.path("/static"))?;
    assert!(fresh.console_messages().is_empty());
    Ok(())
}

#[test]
fn unsupported_stylesheet_rules_preserve_their_names_and_recover() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = fixture.browser()?;
    for (name, source) in [
        ("import", "@import url('/extra.css');"),
        ("page", "@page { margin: 1cm; }"),
        ("scope", "@scope (.outer) { body { color: red; } }"),
    ] {
        let page = browser.navigate(&fixture.path("/static"))?;
        let error = page.evaluate(&format!("(()=>{{const style=document.createElement('style');style.textContent={};document.head.append(style);return getComputedStyle(document.body).display}})()",json!(source))).err().ok_or("unsupported rule was accepted")?;
        assert!(
            error
                .to_string()
                .contains(&format!("stylesheet at-rule: {name}")),
            "{error}"
        );
        let fresh = browser.navigate(&fixture.path("/static"))?;
        assert_eq!(
            fresh.evaluate("getComputedStyle(document.body).display")?,
            json!("block")
        );
    }
    Ok(())
}

#[test]
fn external_imports_load_relative_resources_before_the_parent_event() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/stylesheet-imports.txt"))?;
    let checks = result.as_object().ok_or("missing import checks")?;
    assert_eq!(checks.len(), 16);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn external_imports_share_request_byte_and_depth_limits() -> TestResult {
    let fixture = Fixture::new()?;
    for (path, limits, expected) in [
        (
            "import-large.css",
            Limits {
                max_stylesheet_bytes: 1024,
                ..Limits::default()
            },
            "stylesheet total bytes",
        ),
        (
            "import-root.css",
            Limits {
                max_requests: 2,
                ..Limits::default()
            },
            "request count",
        ),
        (
            "depth-0.css",
            Limits {
                max_requests: 128,
                ..Limits::default()
            },
            "stylesheet import depth",
        ),
    ] {
        let browser = Browser::new(&fixture.url, limits)?;
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let error = page.evaluate(&format!("new Promise(resolve=>{{const link=document.createElement('link');link.rel='stylesheet';link.href='/sheets-css/{path}';link.onload=()=>resolve(true);link.onerror=()=>resolve(false);document.head.append(link);}})")).err().ok_or("import exceeded its limit")?;
        assert!(error.to_string().contains(expected), "{error}");
        let fresh = browser.navigate(&fixture.path("/empty-layout"))?;
        assert_eq!(fresh.evaluate("document.styleSheets.length")?, json!(0));
    }
    Ok(())
}

#[test]
fn stylesheet_selector_budget_is_shared_across_rules_and_sheets() -> TestResult {
    let fixture = Fixture::new()?;
    for (budget, count, sheets, accepted) in [
        (4096, 81, 1, true),
        (4096, 4096, 1, true),
        (4096, 4097, 1, false),
        (4096, 2049, 2, false),
        (8192, 8192, 1, true),
        (8192, 8193, 1, false),
        (8192, 4096, 2, true),
        (8192, 4097, 2, false),
        (32768, 8192, 4, true),
        (32768, 8193, 4, false),
    ] {
        let browser = Browser::new(
            &fixture.url,
            Limits {
                max_stylesheet_selectors: budget,
                max_stylesheet_bytes: 2 * 1024 * 1024,
                max_dom_operations: 1_000_000,
                ..Limits::default()
            },
        )?;
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let result = page.evaluate(&format!(
            "{}({count},{sheets})",
            include_str!("fixtures/stylesheet-selector-budget.txt")
        ));
        if accepted {
            assert_eq!(result?, json!("73px"));
        } else {
            let error = result.err().ok_or("selector budget was exceeded")?;
            assert!(
                error
                    .to_string()
                    .contains("resource limit: stylesheet selectors"),
                "{error}"
            );
        }
        let fresh = browser.navigate(&fixture.path("/empty-layout"))?;
        assert_eq!(fresh.evaluate("document.styleSheets.length")?, json!(0));
    }
    Ok(())
}

#[test]
fn stylesheet_selector_budget_includes_imported_rules() -> TestResult {
    let fixture = Fixture::new()?;
    for (budget, accepted) in [(162, true), (161, false)] {
        let browser = Browser::new(
            &fixture.url,
            Limits {
                max_stylesheet_selectors: budget,
                ..Limits::default()
            },
        )?;
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        let result = page.evaluate(include_str!("fixtures/stylesheet-selector-import.txt"));
        if accepted {
            assert_eq!(result?, json!("73px"));
        } else {
            let error = result
                .err()
                .ok_or("imported selectors exceeded the budget")?;
            assert!(
                error
                    .to_string()
                    .contains("resource limit: stylesheet selectors"),
                "{error}"
            );
        }
        let fresh = browser.navigate(&fixture.path("/empty-layout"))?;
        assert_eq!(fresh.evaluate("document.styleSheets.length")?, json!(0));
    }
    Ok(())
}

#[test]
fn native_nesting_preserves_cascade_conditions_and_live_changes() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/nesting.txt"))?;
    let checks = result.as_object().ok_or("missing nesting checks")?;
    assert_eq!(checks.len(), 21);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn nesting_output_is_bounded_before_cascade_and_recovers() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_stylesheet_bytes: 1024,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/empty-layout"))?;
    assert_eq!(
        page.evaluate(include_str!("fixtures/nesting-limits.txt"))?,
        json!({"limited":true,"recovered":true})
    );
    Ok(())
}

#[test]
fn unrecognized_prefixed_stylesheet_rules_preserve_local_styles() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    assert_eq!(
        page.evaluate(include_str!("fixtures/vendor-rules.txt"))?,
        json!({"block":true,"statement":true,"media":true,"escaped":true})
    );
    Ok(())
}

#[test]
fn computed_cascade_traversal_keeps_dom_and_layout_budgets_separate() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_layout_nodes: 16,
            max_dom_operations: 100_000,
            ..Limits::default()
        },
    )?;
    let page = browser.navigate(&fixture.path("/empty-layout"))?;
    assert_eq!(
        page.evaluate(include_str!("fixtures/computed-traversal.txt"))?,
        json!({"display":true,"layoutLimited":true,"recovered":true})
    );
    Ok(())
}

#[test]
fn computed_insets_use_native_positioning_and_live_containing_blocks() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/computed-insets.txt"))?;
    let checks = result.as_object().ok_or("missing inset checks")?;
    assert_eq!(checks.len(), 23);
    for (name, check) in checks {
        assert_eq!(check["actual"], check["expected"], "{name}");
    }
    Ok(())
}

#[test]
fn baseline_inline_wrappers_preserve_native_text_shaping() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/inline-baseline.txt"))?;
    let checks = result.as_object().ok_or("missing baseline checks")?;
    assert_eq!(checks.len(), 18);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    assert_eq!(
        page.evaluate(include_str!("fixtures/inline-baseline-boundary.txt"))?,
        json!({"rejected":true,"recovered":true})
    );
    Ok(())
}

#[test]
fn inline_padding_participates_in_native_text_width_and_line_breaks() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/inline-padding.txt"))?;
    let checks = result.as_object().ok_or("missing inline padding checks")?;
    assert_eq!(checks.len(), 32);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    assert_eq!(
        page.evaluate(include_str!("fixtures/inline-padding-boundary.txt"))?,
        json!({"vertical":true,"transform":true,"limited":true,"recovered":true})
    );
    Ok(())
}

#[test]
fn mixed_inline_and_block_children_form_anonymous_blocks() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/mixed-inline-blocks.txt"))?;
    let checks = result.as_object().ok_or("missing mixed inline checks")?;
    assert_eq!(checks.len(), 21);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    assert_eq!(
        page.evaluate(include_str!("fixtures/mixed-inline-boundary.txt"))?,
        json!({"flow":true,"nestedBlock":true,"contents":true,"fragment":true,"limit":true,"recovery":true})
    );
    Ok(())
}

#[test]
fn inline_font_metrics_follow_their_native_text_spans() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/inline-font-metrics.txt"))?;
    let checks = result.as_object().ok_or("missing font metrics checks")?;
    assert_eq!(checks.len(), 35);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    assert_eq!(
        page.evaluate(include_str!("fixtures/inline-font-metrics-boundary.txt"))?,
        json!({"whitespace":true,"direction":true,"transform":true,"transformedMetrics":true,"borders":true,"vertical":true,"source":true,"budget":true,"recovery":true,"rounding":true})
    );
    Ok(())
}

#[test]
fn native_user_select_property_family_does_not_change_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/user-select-geometry.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing user-select geometry checks")?;
    assert_eq!(checks.len(), 44);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    let result = page.evaluate(include_str!("fixtures/user-select-contract.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing user-select contract checks")?;
    assert_eq!(checks.len(), 16);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn semantic_inline_emphasis_uses_html_defaults_and_native_font_traits() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/semantic-emphasis.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing semantic emphasis checks")?;
    assert_eq!(checks.len(), 40);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    let result = page.evaluate(include_str!("fixtures/semantic-emphasis-boundary.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing emphasis boundary checks")?;
    assert_eq!(checks.len(), 15);
    assert!(
        checks.values().all(|value| value == &json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn button_flow_uses_native_fit_content_and_content_alignment() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/button-flow.txt"))?;
    let fields = result.as_object().ok_or("missing button flow result")?;
    assert_eq!(fields.len(), 36);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    let result = page.evaluate(include_str!("fixtures/button-flow-boundary.txt"))?;
    let fields = result.as_object().ok_or("missing button boundary result")?;
    assert_eq!(fields.len(), 15);
    assert!(
        fields.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn static_inline_insets_preserve_flow_and_scrollable_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/static-inline-insets.txt"))?;
    let checks = result.as_object().ok_or("missing static inset checks")?;
    assert_eq!(checks.len(), 58);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    let result = page.evaluate(include_str!("fixtures/static-inline-insets-boundary.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing static inset boundaries")?;
    assert_eq!(checks.len(), 6);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn atomic_middle_alignment_uses_parent_font_metrics_and_native_baselines() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/empty-layout"))?;
    let result = page.evaluate(include_str!("fixtures/atomic-middle.txt"))?;
    let checks = result.as_object().ok_or("missing atomic middle checks")?;
    assert_eq!(checks.len(), 37);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn image_resources_decode_select_density_and_preserve_pending_state() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/page"))?;
    let result = page.evaluate(include_str!("fixtures/image-resources.txt"))?;
    let checks = result.as_object().ok_or("missing image resource checks")?;
    assert_eq!(checks.len(), 27);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn image_resources_enforce_decoded_memory_before_allocating_pixels() -> TestResult {
    let fixture = Fixture::new()?;
    let browser = Browser::new(
        &fixture.url,
        Limits {
            max_response_bytes: 256,
            ..Limits::default()
        },
    )?;
    assert!(matches!(
        browser.navigate(&fixture.path("/image-resources/page")),
        Err(Error::Limit("decoded image bytes"))
    ));
    Ok(())
}

#[test]
fn image_resources_discover_detached_images_without_initial_image_tags() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate("new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight,image.isConnected]);image.onerror=reject;image.src='/image-resources/small.png';})")?;
    assert_eq!(result, json!([32, 16, false]));
    Ok(())
}

#[test]
fn image_resources_defer_empty_source_error_until_parser_scripts() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty-source"))?;
    assert_eq!(page.evaluate("[imageErrors,document.getElementById('empty').complete,document.getElementById('empty').naturalWidth]")?, json!([1,true,0]));
    Ok(())
}

#[test]
fn image_layout_uses_native_intrinsic_sizes_and_atomic_lines() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/image-layout.txt"))?;
    let checks = result.as_object().ok_or("missing image layout checks")?;
    assert_eq!(checks.len(), 59);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn image_layout_rejects_unsized_alternate_text() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result=page.evaluate("(async()=>{const image=new Image();image.alt='fallback';const ready=new Promise(resolve=>image.onerror=resolve);image.src='/image-resources/broken.png';document.body.append(image);await ready;return image.getBoundingClientRect().width})()");
    assert!(
        matches!(result,Err(Error::JavaScript(message)) if message.contains("broken image or alternate text layout"))
    );
    Ok(())
}

#[test]
fn computed_sizes_preserve_non_applicable_and_unboxed_values() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/computed-sizes.txt"))?;
    let checks = result.as_object().ok_or("missing computed size checks")?;
    assert_eq!(checks.len(), 36);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn computed_sizes_keep_vertical_layout_explicit() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result=page.evaluate("(()=>{const parent=document.createElement('div');parent.style.writingMode='vertical-rl';const node=document.createElement('span');node.style.inlineSize='50%';parent.append(node);document.body.append(parent);return getComputedStyle(node).width})()");
    assert!(matches!(result,Err(Error::JavaScript(message)) if message.contains("writing-mode")));
    Ok(())
}

#[test]
fn atomic_inline_offsets_use_own_font_and_line_height() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/atomic-offsets.txt"))?;
    let checks = result.as_object().ok_or("missing atomic offset checks")?;
    assert_eq!(checks.len(), 40);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn inline_flow_shapes_text_and_atomic_boxes_together() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/inline-flow.txt"))?;
    let checks = result.as_object().ok_or("missing inline flow checks")?;
    assert_eq!(checks.len(), 31);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn inline_flow_keeps_unsupported_boundaries_explicit_and_recovers() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/inline-flow-boundaries.txt"))?;
    let checks = result.as_object().ok_or("missing inline boundary checks")?;
    assert_eq!(checks.len(), 8);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn background_paint_state_does_not_block_native_box_geometry() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/background-geometry.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing background geometry checks")?;
    assert_eq!(checks.len(), 23);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn background_geometry_preserves_explicit_cssom_and_paint_boundaries() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/background-geometry-boundaries.txt"))?;
    let checks = result
        .as_object()
        .ok_or("missing background boundary checks")?;
    assert_eq!(checks.len(), 8);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn generated_text_uses_native_shaping_and_box_formatting() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/generated-text.txt"))?;
    let checks = result.as_object().ok_or("missing generated text checks")?;
    assert_eq!(checks.len(), 40);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn generated_text_preserves_explicit_boundaries_and_recovers() -> TestResult {
    let fixture = Fixture::new()?;
    let page = fixture
        .browser()?
        .navigate(&fixture.path("/image-resources/empty"))?;
    let result = page.evaluate(include_str!("fixtures/generated-text-boundaries.txt"))?;
    let checks = result.as_object().ok_or("missing generated text checks")?;
    assert_eq!(checks.len(), 14);
    assert!(
        checks.values().all(|value| *value == json!(true)),
        "{result}"
    );
    Ok(())
}

#[test]
fn native_out_of_flow_candidates_preserve_static_positions_and_grid_areas() -> TestResult {
    let fixture = Fixture::new()?;
    each_variant(&fixture, |browser, variant| {
        let page = browser.navigate(&fixture.path("/empty-layout"))?;
        page.evaluate(&format!("globalThis.variant={variant}"))?;
        let result = page.evaluate(&format!(
            "(()=>{{{} return globalThis.comparison;}})()",
            include_str!("fixtures/static-position.txt")
        ))?;
        let checks = result.as_object().ok_or("missing positioning checks")?;
        assert_eq!(checks.len(), 19);
        assert!(
            checks.values().all(|value| value == &json!(true)),
            "{result}"
        );
        Ok(())
    })
}
