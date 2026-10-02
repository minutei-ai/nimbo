use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, VecDeque},
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use rquickjs::{Context, Ctx, Exception, Function, Persistent, Promise, Runtime};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{
    Error, Limits, MediaEnvironment, Result, dom::Dom, modules::Modules, storage::Storage,
};

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
    Wait {
        milliseconds: f64,
    },
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
    purpose: RequestPurpose,
}

enum RequestPurpose {
    Fetch(Resolver),
    ClassicScript,
    Stylesheet(usize),
    Module(String),
}

struct Script {
    src: Option<String>,
    source: String,
    module: bool,
    deferred: bool,
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
    timer: Option<Persistent<Function<'static>>>,
    intersections: Option<Persistent<Function<'static>>>,
    resource: Option<Persistent<Function<'static>>>,
    clock: Rc<Cell<f64>>,
    evaluation: Option<Persistent<Promise<'static>>>,
    active: Option<Request>,
    pending: Rc<RefCell<VecDeque<Request>>>,
    scripts: VecDeque<Script>,
    modules: Modules,
    module_root: Option<String>,
    module_evaluations: HashMap<String, Persistent<Promise<'static>>>,
    parsed: bool,
    context: Context,
    runtime: Runtime,
    rejections: Rc<Cell<usize>>,
    ticks: Arc<AtomicUsize>,
    check: Check,
    jobs: usize,
    limits: Limits,
    phase: Phase,
    base: Url,
    dom: Rc<RefCell<Dom>>,
}

impl Drop for Machine {
    fn drop(&mut self) {
        // Native callbacks also retain this queue: explicitly break that reference cycle.
        self.pending.borrow_mut().clear();
    }
}

fn install_clock(ctx: &Ctx<'_>, clock: Rc<Cell<f64>>, limits: Limits) -> Result<()> {
    let globals = ctx.globals();
    js(
        ctx,
        globals.set(
            "nimboNow",
            js(ctx, Function::new(ctx.clone(), move || clock.get()))?,
        ),
    )?;
    js(ctx, globals.set("nimboTimerLimit", limits.max_timers))?;
    js(
        ctx,
        globals.set("nimboTimerTaskLimit", limits.max_timer_tasks),
    )?;
    Ok(())
}

fn callback<'js>(
    ctx: &Ctx<'js>,
    callbacks: &rquickjs::Object<'js>,
    name: &str,
) -> Result<Persistent<Function<'static>>> {
    let function: Function<'_> = js(ctx, callbacks.get(name))?;
    Ok(Persistent::save(ctx, function))
}

impl Machine {
    pub(crate) fn new(
        html: &str,
        url: &str,
        limits: Limits,
        check: Check,
        execute_scripts: bool,
        storage: Rc<RefCell<Storage>>,
        media: MediaEnvironment,
    ) -> Result<Self> {
        if html.len() > limits.max_response_bytes {
            return Err(Error::Limit("HTML bytes"));
        }
        let base = parse_url(url)?;
        let dom = Rc::new(RefCell::new(Dom::new(
            html,
            limits,
            media.clone(),
            base.clone(),
        )));
        let scripts = collect_scripts(&dom.borrow(), execute_scripts)?;
        let runtime = Runtime::new().map_err(|error| Error::JavaScript(error.to_string()))?;
        let modules = Modules::new(base.clone());
        modules.install(&runtime);
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
            timer: None,
            intersections: None,
            resource: None,
            clock: Rc::new(Cell::new(0.0)),
            evaluation: None,
            active: None,
            pending: Rc::default(),
            scripts,
            modules,
            module_root: None,
            module_evaluations: HashMap::new(),
            parsed: false,
            context,
            runtime,
            rejections,
            ticks,
            check,
            jobs: 0,
            limits,
            phase: Phase::Scripts,
            base,
            dom: Rc::clone(&dom),
        };
        machine.bootstrap(dom, url, storage, media)?;
        machine.check_budget()?;
        Ok(machine)
    }

    fn bootstrap(
        &mut self,
        dom: Rc<RefCell<Dom>>,
        url: &str,
        storage: Rc<RefCell<Storage>>,
        media: MediaEnvironment,
    ) -> Result<()> {
        let limits = self.limits;
        let pending = Rc::clone(&self.pending);
        let request_base = self.base.clone();
        let request_dom = Rc::clone(&dom);
        let dom_check = Arc::clone(&self.check);
        let requests = Rc::new(Cell::new(0_usize));
        let clock = Rc::clone(&self.clock);
        let (ready, timer, intersections, resource) = self.context.with(|ctx| -> Result<_> {
            let globals = ctx.globals();
            install_clock(&ctx, clock, limits)?;
            let dom_function = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, op: String, handle: usize, arg: String, value: String| {
                    if dom_check() {
                        return Err(Exception::throw_message(&ctx, "navigation deadline"));
                    }
                    dom.borrow_mut()
                        .call(&op, handle, &arg, &value)
                        .map_err(|error| match error {
                            Error::DomException { name, message } => {
                                Exception::throw_dom(&ctx, name, message)
                            }
                            error => Exception::throw_message(&ctx, &error.to_string()),
                        })
                },
            );
            js(&ctx, globals.set("nimboDom", js(&ctx, dom_function)?))?;
            let request = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, url: String, method: String, body: String| {
                    let url = resolve_document(&request_base, &request_dom.borrow(), &url)
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
                        purpose: RequestPurpose::Fetch(Resolver {
                            resolve: Persistent::save(&ctx, resolve),
                            reject: Persistent::save(&ctx, reject),
                        }),
                    });
                    Ok(Persistent::save(&ctx, promise))
                },
            );
            js(&ctx, globals.set("nimboRequest", js(&ctx, request)?))?;
            let storage_call = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, area: usize, operation: String, key: String, value: String| {
                    storage
                        .borrow_mut()
                        .call(area, &operation, &key, &value, limits.max_storage_bytes)
                        .map_err(|error| match error {
                            Error::DomException { name, message } => {
                                Exception::throw_dom(&ctx, name, message)
                            }
                            error => Exception::throw_message(&ctx, &error.to_string()),
                        })
                },
            );
            js(&ctx, globals.set("nimboStorage", js(&ctx, storage_call)?))?;
            install_media(&ctx, media)?;
            js(&ctx, crate::encoding::install(&ctx))?;
            js(&ctx, crate::links::install(&ctx))?;
            js(&ctx, globals.set("nimboUrl", url))?;
            let callbacks = js(
                &ctx,
                ctx.eval::<rquickjs::Object<'_>, _>(include_str!(concat!(
                    env!("OUT_DIR"),
                    "/web.js"
                ))),
            )?;
            Ok((
                callback(&ctx, &callbacks, "ready")?,
                callback(&ctx, &callbacks, "timer")?,
                callback(&ctx, &callbacks, "intersections")?,
                callback(&ctx, &callbacks, "resource")?,
            ))
        })?;
        self.ready = Some(ready);
        self.timer = Some(timer);
        self.intersections = Some(intersections);
        self.resource = Some(resource);
        Ok(())
    }

    pub(crate) fn advance(&self, milliseconds: f64) -> Result<()> {
        if !milliseconds.is_finite() || milliseconds < self.clock.get() {
            return Err(Error::Unsupported(
                "clock must be finite and monotonic".into(),
            ));
        }
        self.clock.set(milliseconds);
        Ok(())
    }

    fn sheet_response(
        &self,
        handle: usize,
        url: String,
        response: Option<&Response>,
    ) -> Result<()> {
        let success = self
            .dom
            .borrow_mut()
            .sheet_response(handle, url, response)?;
        let callback = self
            .resource
            .as_ref()
            .ok_or_else(|| Error::JavaScript("missing resource callback".into()))?;
        self.context.with(|ctx| {
            js(
                &ctx,
                js(&ctx, callback.clone().restore(&ctx))?.call::<_, ()>((handle, success)),
            )
        })
    }

    fn intersection_step(&self) -> Result<bool> {
        let callback = self
            .intersections
            .as_ref()
            .ok_or_else(|| Error::JavaScript("missing intersection scheduler".into()))?;
        self.context.with(|ctx| {
            js(
                &ctx,
                js(&ctx, callback.clone().restore(&ctx))?.call::<_, bool>(()),
            )
        })
    }

    fn timer_step(&self, run: bool) -> Result<Option<f64>> {
        let callback = self
            .timer
            .as_ref()
            .ok_or_else(|| Error::JavaScript("missing timer scheduler".into()))?;
        self.context.with(|ctx| {
            js(
                &ctx,
                js(&ctx, callback.clone().restore(&ctx))?.call::<_, Option<f64>>((run,)),
            )
        })
    }

    fn check_budget(&self) -> Result<()> {
        if (self.check)() || self.clock.get() >= self.limits.timeout.as_secs_f64() * 1000.0 {
            return Err(Error::Limit("navigation deadline"));
        }
        if self.ticks.load(Ordering::Relaxed) == 0 {
            return Err(Error::Limit("JavaScript fuel"));
        }
        Ok(())
    }

    fn execute(&self, source: &str, filename: &str) -> Result<()> {
        self.check_budget()?;
        let result = self.context.with(|ctx| {
            let mut options = rquickjs::context::EvalOptions::default();
            options.filename = Some(filename.to_owned());
            js(&ctx, ctx.eval_with_options::<(), _>(source, options))
        });
        self.check_budget()?;
        result
    }

    fn next_script(&mut self) -> Result<Option<Action>> {
        if let Some(root) = self.module_root.clone() {
            if let Some(url) = self.modules.prepare(&self.runtime, &root)? {
                resolve(&self.base, &url)?;
                return Ok(Some(self.activate(Request {
                    url: url.clone(),
                    method: "GET".into(),
                    body: String::new(),
                    purpose: RequestPurpose::Module(url),
                })));
            }
            if !self.module_evaluations.contains_key(&root) {
                let promise = self.context.with(|ctx| -> Result<_> {
                    Ok(Persistent::save(
                        &ctx,
                        js(&ctx, self.modules.evaluate(&ctx, &root))?,
                    ))
                })?;
                self.module_evaluations.insert(root, promise);
            }
            self.module_root = None;
            return Ok(None);
        }
        if let Some(script) = self.scripts.pop_front() {
            let document_base =
                crate::links::base(self.dom.borrow().base_href().as_deref(), self.base.as_str())
                    .unwrap_or_else(|| self.base.clone());
            if script.deferred && !self.parsed {
                self.context.with(|ctx| -> Result<()> {
                    let callback = self
                        .ready
                        .as_ref()
                        .ok_or_else(|| Error::JavaScript("missing lifecycle callback".into()))?;
                    js(
                        &ctx,
                        js(&ctx, callback.clone().restore(&ctx))?.call::<_, ()>((false,)),
                    )
                })?;
                self.parsed = true;
            }
            if script.module {
                let root = if let Some(src) = script.src {
                    resolve(
                        &self.base,
                        document_base
                            .join(&src)
                            .map_err(|error| Error::InvalidUrl(error.to_string()))?
                            .as_str(),
                    )?
                    .to_string()
                } else {
                    let root = format!("nimbo:inline:{}", self.scripts.len());
                    self.modules
                        .inline(root.clone(), script.source, document_base.to_string());
                    root
                };
                self.module_root = Some(root);
                return Ok(None);
            }
            if let Some(src) = script.src {
                let url = resolve(
                    &self.base,
                    document_base
                        .join(&src)
                        .map_err(|error| Error::InvalidUrl(error.to_string()))?
                        .as_str(),
                )?;
                return Ok(Some(self.activate(Request {
                    url: url.to_string(),
                    method: "GET".into(),
                    body: String::new(),
                    purpose: RequestPurpose::ClassicScript,
                })));
            }
            self.execute(&script.source, self.base.as_str())?;
        } else {
            self.phase = Phase::Lifecycle;
        }
        Ok(None)
    }

    fn next_sheet(&mut self) -> Result<Option<Action>> {
        let sheet = self.dom.borrow_mut().next_sheet()?;
        Ok(sheet.map(|(handle, url)| {
            self.activate(Request {
                url,
                method: "GET".into(),
                body: String::new(),
                purpose: RequestPurpose::Stylesheet(handle),
            })
        }))
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
            self.timer_step(false)?;
            for promise in self.module_evaluations.values() {
                self.context.with(|ctx| -> Result<()> {
                    let promise = js(&ctx, promise.clone().restore(&ctx))?;
                    if let Some(result) = promise.result::<()>() {
                        js(&ctx, result)?;
                    }
                    Ok(())
                })?;
            }
            if let Some(action) = self.next_sheet()? {
                return Ok(action);
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
                    if let Some(action) = self.next_script()? {
                        return Ok(action);
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
                Phase::Ready => {
                    if self.intersection_step()? {
                        continue;
                    }
                    if self.timer_step(true)? == Some(0.0) {
                        continue;
                    }
                    return Ok(Action::Ready);
                }
                Phase::Evaluating => {
                    if self.intersection_step()? {
                        continue;
                    }
                    let pending = self.context.with(|ctx| -> Result<bool> {
                        let promise = self
                            .evaluation
                            .as_ref()
                            .ok_or_else(|| Error::JavaScript("missing evaluation".into()))?;
                        Ok(js(&ctx, promise.clone().restore(&ctx))?
                            .result::<String>()
                            .is_none())
                    })?;
                    if pending && let Some(milliseconds) = self.timer_step(true)? {
                        if milliseconds <= 0.0 {
                            continue;
                        }
                        return Ok(Action::Wait { milliseconds });
                    }
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
        if let RequestPurpose::Stylesheet(handle) = request.purpose {
            self.sheet_response(handle, request.url, Some(response))?;
        } else if let RequestPurpose::Module(name) = request.purpose {
            self.modules.respond(name, response)?;
        } else if let RequestPurpose::Fetch(resolver) = request.purpose {
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
            self.execute(&response.body, &response.url)?;
        }
        Ok(())
    }

    pub(crate) fn reject(&mut self, message: &str) -> Result<()> {
        let request = self
            .active
            .take()
            .ok_or_else(|| Error::Unsupported("no pending request".into()))?;
        if let RequestPurpose::Stylesheet(handle) = request.purpose {
            return self.sheet_response(handle, request.url, None);
        }
        let RequestPurpose::Fetch(resolver) = request.purpose else {
            return Err(Error::JavaScript(message.to_owned()));
        };
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
            let mut options = rquickjs::context::EvalOptions::default();
            options.filename = Some(self.base.to_string());
            let promise = js(
                &ctx,
                ctx.eval_with_options::<Promise<'_>, _>(source, options),
            )?;
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

fn resolve_document(origin: &Url, dom: &Dom, value: &str) -> Result<Url> {
    let base = crate::links::base(dom.base_href().as_deref(), origin.as_str())
        .unwrap_or_else(|| origin.clone());
    let url = base
        .join(value)
        .map_err(|error| Error::InvalidUrl(error.to_string()))?;
    resolve(origin, url.as_str())
}

pub(crate) fn resolve(base: &Url, value: &str) -> Result<Url> {
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

fn install_media(ctx: &Ctx<'_>, media: MediaEnvironment) -> Result<()> {
    let globals = ctx.globals();
    js(
        ctx,
        globals.set("nimboMediaEnvironment", serde_json::to_string(&media)?),
    )?;
    let media_query = Function::new(ctx.clone(), move |ctx: Ctx<'_>, source: String| {
        media
            .query(&source)
            .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
    });
    js(ctx, globals.set("nimboMedia", js(ctx, media_query)?))?;
    Ok(())
}

fn js<T>(ctx: &Ctx<'_>, result: rquickjs::Result<T>) -> Result<T> {
    rquickjs::CaughtError::catch(ctx, result).map_err(|error| {
        // QuickJS DOMException is not an Error subclass. Preserve its diagnostics
        // instead of returning the library's opaque Object(pointer) display.
        let message = match &error {
            rquickjs::CaughtError::Value(value) => value
                .as_object()
                .and_then(|object| {
                    let name =
                        rquickjs::CaughtError::catch(ctx, object.get::<_, String>("name")).ok()?;
                    let message =
                        rquickjs::CaughtError::catch(ctx, object.get::<_, String>("message"))
                            .ok()?;
                    Some(format!("{name}: {message}"))
                })
                .unwrap_or_else(|| error.to_string()),
            _ => error.to_string(),
        };
        Error::JavaScript(message)
    })
}

fn collect_scripts(dom: &Dom, execute_scripts: bool) -> Result<VecDeque<Script>> {
    if dom.document.select("iframe, frame").exists() {
        return Err(Error::Unsupported("frames".into()));
    }
    let mut scripts = VecDeque::new();
    let mut modules = VecDeque::new();
    if !execute_scripts {
        return Ok(scripts);
    }
    for node in dom.document.select("script").nodes() {
        let kind = node
            .attr("type")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            kind.as_str(),
            "" | "text/javascript" | "application/javascript" | "module"
        ) {
            continue;
        }
        if kind != "module" && node.attr("nomodule").is_some() {
            continue;
        }
        if node.attr("async").is_some() {
            return Err(Error::Unsupported("async script scheduling".into()));
        }
        let deferred =
            kind == "module" || (node.attr("src").is_some() && node.attr("defer").is_some());
        let script = Script {
            src: node.attr("src").map(|src| src.to_string()),
            source: node.text().to_string(),
            module: kind == "module",
            deferred,
        };
        if deferred {
            modules.push_back(script);
        } else {
            scripts.push_back(script);
        }
    }
    scripts.extend(modules);
    Ok(scripts)
}
