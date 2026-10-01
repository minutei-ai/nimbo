use std::{
    cell::{Cell, RefCell},
    collections::VecDeque,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use rquickjs::{Context, Ctx, Exception, Function, Persistent, Promise, Runtime};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{Error, Limits, Result, dom::Dom};

type Check = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Response {
    pub url: String,
    pub status: u16,
    pub body: String,
    pub content_type: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Action {
    Request {
        url: String,
        method: String,
        body: String,
    },
    Ready,
    Result {
        json: String,
    },
}

struct Resolver {
    resolve: Persistent<Function<'static>>,
    reject: Persistent<Function<'static>>,
}

struct Request {
    url: String,
    method: String,
    body: String,
    resolver: Option<Resolver>,
}

struct Script {
    src: Option<String>,
    source: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Scripts,
    Lifecycle,
    Ready,
    Evaluating,
}

pub(crate) struct Machine {
    // All persistent values, including callback-owned queues, must be cleared before Context.
    ready: Option<Persistent<Function<'static>>>,
    evaluation: Option<Persistent<Promise<'static>>>,
    active: Option<Request>,
    pending: Rc<RefCell<VecDeque<Request>>>,
    scripts: VecDeque<Script>,
    context: Context,
    runtime: Runtime,
    rejections: Rc<Cell<usize>>,
    ticks: Arc<AtomicUsize>,
    check: Check,
    jobs: usize,
    limits: Limits,
    phase: Phase,
    base: Url,
}

impl Drop for Machine {
    fn drop(&mut self) {
        // Native callbacks also retain this queue: explicitly break that reference cycle.
        self.pending.borrow_mut().clear();
    }
}

impl Machine {
    pub(crate) fn new(
        html: &str,
        url: &str,
        limits: Limits,
        check: Check,
        execute_scripts: bool,
    ) -> Result<Self> {
        if html.len() > limits.max_response_bytes {
            return Err(Error::Limit("HTML bytes"));
        }
        let base = parse_url(url)?;
        let dom = Rc::new(RefCell::new(Dom::new(html, limits)));
        let scripts = collect_scripts(&dom.borrow(), execute_scripts)?;
        let runtime = Runtime::new().map_err(|error| Error::JavaScript(error.to_string()))?;
        runtime.set_memory_limit(limits.javascript_memory_bytes);
        runtime.set_max_stack_size(512 * 1024);
        let ticks = Arc::new(AtomicUsize::new(limits.max_javascript_ticks));
        let fuel = Arc::clone(&ticks);
        let interrupt = Arc::clone(&check);
        runtime.set_interrupt_handler(Some(Box::new(move || {
            interrupt()
                || fuel
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |left| {
                        left.checked_sub(1)
                    })
                    .is_err()
        })));
        let rejections = Rc::new(Cell::new(0_usize));
        let tracker = Rc::clone(&rejections);
        runtime.set_host_promise_rejection_tracker(Some(Box::new(move |_, _, _, handled| {
            tracker.set(if handled {
                tracker.get().saturating_sub(1)
            } else {
                tracker.get().saturating_add(1)
            });
        })));
        let context =
            Context::full(&runtime).map_err(|error| Error::JavaScript(error.to_string()))?;
        let mut machine = Self {
            ready: None,
            evaluation: None,
            active: None,
            pending: Rc::default(),
            scripts,
            context,
            runtime,
            rejections,
            ticks,
            check,
            jobs: 0,
            limits,
            phase: Phase::Scripts,
            base,
        };
        machine.bootstrap(dom, url)?;
        machine.check_budget()?;
        Ok(machine)
    }

    fn bootstrap(&mut self, dom: Rc<RefCell<Dom>>, url: &str) -> Result<()> {
        let limits = self.limits;
        let pending = Rc::clone(&self.pending);
        let request_base = self.base.clone();
        let dom_check = Arc::clone(&self.check);
        let requests = Rc::new(Cell::new(0_usize));
        self.ready = Some(self.context.with(|ctx| -> Result<_> {
            let globals = ctx.globals();
            let dom_function = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, op: String, handle: usize, arg: String, value: String| {
                    if dom_check() {
                        return Err(Exception::throw_message(&ctx, "navigation deadline"));
                    }
                    dom.borrow_mut()
                        .call(&op, handle, &arg, &value)
                        .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
                },
            );
            js(&ctx, globals.set("nimboDom", js(&ctx, dom_function)?))?;
            let request = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, url: String, method: String, body: String| {
                    let url = resolve(&request_base, &url)
                        .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?;
                    if !matches!(method.as_str(), "GET" | "POST") {
                        return Err(Exception::throw_message(&ctx, "only GET and POST"));
                    }
                    if body.len() > limits.max_response_bytes
                        || requests.get() >= limits.max_requests
                    {
                        return Err(Exception::throw_message(&ctx, "request budget"));
                    }
                    requests.set(requests.get().saturating_add(1));
                    let (promise, resolve, reject) = ctx.promise()?;
                    pending.borrow_mut().push_back(Request {
                        url: url.to_string(),
                        method,
                        body,
                        resolver: Some(Resolver {
                            resolve: Persistent::save(&ctx, resolve),
                            reject: Persistent::save(&ctx, reject),
                        }),
                    });
                    Ok(Persistent::save(&ctx, promise))
                },
            );
            js(&ctx, globals.set("nimboRequest", js(&ctx, request)?))?;
            js(&ctx, globals.set("nimboUrl", url))?;
            let ready = js(
                &ctx,
                ctx.eval::<Function<'_>, _>(include_str!(concat!(env!("OUT_DIR"), "/web.js"))),
            )?;
            Ok(Persistent::save(&ctx, ready))
        })?);
        Ok(())
    }

    fn check_budget(&self) -> Result<()> {
        if (self.check)() {
            return Err(Error::Limit("navigation deadline"));
        }
        if self.ticks.load(Ordering::Relaxed) == 0 {
            return Err(Error::Limit("JavaScript fuel"));
        }
        Ok(())
    }

    fn execute(&self, source: &str) -> Result<()> {
        self.check_budget()?;
        let result = self.context.with(|ctx| js(&ctx, ctx.eval::<(), _>(source)));
        self.check_budget()?;
        result
    }

    pub(crate) fn step(&mut self) -> Result<Action> {
        if self.active.is_some() {
            return Err(Error::Unsupported(
                "response required before next step".into(),
            ));
        }
        loop {
            self.check_budget()?;
            while self.runtime.is_job_pending() {
                if self.jobs >= self.limits.max_microtasks {
                    return Err(Error::Limit("microtask count"));
                }
                self.jobs = self.jobs.saturating_add(1);
                let job = self.runtime.execute_pending_job();
                self.check_budget()?;
                job.map_err(|error| Error::JavaScript(format!("microtask failed: {error:?}")))?;
            }
            let request = self.pending.borrow_mut().pop_front();
            if let Some(request) = request {
                return Ok(self.activate(request));
            }
            if self.rejections.get() != 0 {
                return Err(Error::JavaScript("unhandled Promise rejection".into()));
            }
            match self.phase {
                Phase::Scripts => {
                    if let Some(script) = self.scripts.pop_front() {
                        if let Some(src) = script.src {
                            let url = resolve(&self.base, &src)?;
                            return Ok(self.activate(Request {
                                url: url.to_string(),
                                method: "GET".into(),
                                body: String::new(),
                                resolver: None,
                            }));
                        }
                        self.execute(&script.source)?;
                    } else {
                        self.phase = Phase::Lifecycle;
                    }
                }
                Phase::Lifecycle => {
                    let ready = self
                        .ready
                        .take()
                        .ok_or_else(|| Error::JavaScript("missing lifecycle callback".into()))?;
                    let result = self
                        .context
                        .with(|ctx| js(&ctx, js(&ctx, ready.restore(&ctx))?.call::<_, ()>(())));
                    self.check_budget()?;
                    result?;
                    self.phase = Phase::Ready;
                }
                Phase::Ready => return Ok(Action::Ready),
                Phase::Evaluating => {
                    let promise = self
                        .evaluation
                        .take()
                        .ok_or_else(|| Error::JavaScript("missing evaluation".into()))?;
                    let json = self.context.with(|ctx| -> Result<String> {
                        let promise = js(&ctx, promise.restore(&ctx))?;
                        js(
                            &ctx,
                            promise
                                .result::<String>()
                                .unwrap_or(Err(rquickjs::Error::WouldBlock)),
                        )
                    })?;
                    self.phase = Phase::Ready;
                    return Ok(Action::Result { json });
                }
            }
        }
    }

    fn activate(&mut self, request: Request) -> Action {
        let action = Action::Request {
            url: request.url.clone(),
            method: request.method.clone(),
            body: request.body.clone(),
        };
        self.active = Some(request);
        action
    }

    pub(crate) fn respond(&mut self, response: &Response) -> Result<()> {
        self.check_budget()?;
        let request = self
            .active
            .take()
            .ok_or_else(|| Error::Unsupported("no pending request".into()))?;
        resolve(&self.base, &response.url)?;
        if response.body.len() > self.limits.max_response_bytes {
            return Err(Error::Limit("response bytes"));
        }
        if let Some(resolver) = request.resolver {
            let payload = serde_json::to_string(response)?;
            self.context.with(|ctx| {
                js(
                    &ctx,
                    js(&ctx, resolver.resolve.restore(&ctx))?.call::<_, ()>((payload,)),
                )
            })?;
        } else {
            if !(200..300).contains(&response.status) {
                return Err(Error::HttpStatus(response.status));
            }
            self.execute(&response.body)?;
        }
        Ok(())
    }

    pub(crate) fn reject(&mut self, message: &str) -> Result<()> {
        let request = self
            .active
            .take()
            .ok_or_else(|| Error::Unsupported("no pending request".into()))?;
        let resolver = request
            .resolver
            .ok_or_else(|| Error::JavaScript(message.to_owned()))?;
        self.context.with(|ctx| {
            js(
                &ctx,
                js(&ctx, resolver.reject.restore(&ctx))?.call::<_, ()>((message,)),
            )
        })
    }

    pub(crate) fn evaluate(&mut self, expression: &str) -> Result<()> {
        self.check_budget()?;
        if self.phase != Phase::Ready {
            return Err(Error::Unsupported("page is not ready".into()));
        }
        if expression.len() > self.limits.max_expression_bytes {
            return Err(Error::Limit("expression bytes"));
        }
        let source =
            format!("Promise.resolve(({expression})).then(value => JSON.stringify(value ?? null))");
        let evaluation = self.context.with(|ctx| -> Result<_> {
            let promise = js(&ctx, ctx.eval::<Promise<'_>, _>(source))?;
            Ok(Persistent::save(&ctx, promise))
        });
        self.check_budget()?;
        self.evaluation = Some(evaluation?);
        self.phase = Phase::Evaluating;
        Ok(())
    }
}

pub(crate) fn parse_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|error| Error::InvalidUrl(error.to_string()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::InvalidUrl(
            "only HTTP(S) without URL credentials".into(),
        ));
    }
    Ok(url)
}

fn resolve(base: &Url, value: &str) -> Result<Url> {
    let url = parse_url(
        base.join(value)
            .map_err(|error| Error::InvalidUrl(error.to_string()))?
            .as_str(),
    )?;
    if url.origin() != base.origin() {
        return Err(Error::Origin(url.to_string()));
    }
    Ok(url)
}

fn js<T>(ctx: &Ctx<'_>, result: rquickjs::Result<T>) -> Result<T> {
    rquickjs::CaughtError::catch(ctx, result).map_err(|error| Error::JavaScript(error.to_string()))
}

fn collect_scripts(dom: &Dom, execute_scripts: bool) -> Result<VecDeque<Script>> {
    if dom.document.select("iframe, frame, base[href]").exists() {
        return Err(Error::Unsupported("frames and base URL elements".into()));
    }
    let mut scripts = VecDeque::new();
    if !execute_scripts {
        return Ok(scripts);
    }
    for node in dom.document.select("script").nodes() {
        let kind = node
            .attr("type")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if kind == "module" {
            return Err(Error::Unsupported("module scripts".into()));
        }
        if !matches!(
            kind.as_str(),
            "" | "text/javascript" | "application/javascript"
        ) {
            continue;
        }
        if node.attr("async").is_some() {
            return Err(Error::Unsupported("async script scheduling".into()));
        }
        scripts.push_back(Script {
            src: node.attr("src").map(|src| src.to_string()),
            source: node.text().to_string(),
        });
    }
    Ok(scripts)
}
