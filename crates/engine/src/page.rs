use std::{
    cell::{Cell, RefCell},
    fmt,
    rc::Rc,
};

use rquickjs::{Context, Ctx, Exception, Function, Persistent, Promise, Runtime};
use serde_json::Value;

use crate::{
    Error, Result,
    dom::Dom,
    network::{Response, Transport, parse_url},
};

/// Documento carregado. Drop libera DOM, contexto JS e recursos da página.
pub struct Page {
    // Persistent values must be released before their QuickJS context/runtime.
    ready: Option<Persistent<Function<'static>>>,
    context: Context,
    runtime: Runtime,
    transport: Rc<Transport>,
    url: String,
    unhandled_rejections: Rc<Cell<usize>>,
}

impl fmt::Debug for Page {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Page")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

impl Page {
    pub(crate) fn load(response: Response, transport: Rc<Transport>) -> Result<Self> {
        transport.check_deadline()?;
        let dom = Rc::new(RefCell::new(Dom::new(&response.body, transport.limits)));
        let scripts = collect_scripts(&dom.borrow())?;
        let runtime = Runtime::new().map_err(|error| Error::JavaScript(error.to_string()))?;
        runtime.set_memory_limit(transport.limits.javascript_memory_bytes);
        runtime.set_max_stack_size(512 * 1024);
        let deadline = transport.deadline;
        runtime.set_interrupt_handler(Some(Box::new(move || {
            std::time::Instant::now() >= deadline
        })));
        let unhandled_rejections = Rc::new(Cell::new(0_usize));
        let rejections = Rc::clone(&unhandled_rejections);
        runtime.set_host_promise_rejection_tracker(Some(Box::new(move |_, _, _, handled| {
            rejections.set(if handled {
                rejections.get().saturating_sub(1)
            } else {
                rejections.get().saturating_add(1)
            });
        })));
        let context =
            Context::full(&runtime).map_err(|error| Error::JavaScript(error.to_string()))?;
        let base = parse_url(&response.url)?;
        let ready = context.with(|ctx| -> Result<_> {
            let globals = ctx.globals();
            let dom_transport = Rc::clone(&transport);
            let dom_function = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, op: String, handle: usize, arg: String, value: String| {
                    dom_transport
                        .check_deadline()
                        .and_then(|()| dom.borrow_mut().call(&op, handle, &arg, &value))
                        .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
                },
            );
            js(&ctx, globals.set("nimboDom", js(&ctx, dom_function)?))?;
            let request_transport = Rc::clone(&transport);
            let request_base = base.clone();
            let request = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, url: String, method: String, body: String| {
                    request_transport
                        .request(&request_base, &url, &method, &body)
                        .and_then(|response| serde_json::to_string(&response).map_err(Error::from))
                        .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
                },
            );
            js(&ctx, globals.set("nimboRequest", js(&ctx, request)?))?;
            js(&ctx, globals.set("nimboUrl", response.url.clone()))?;
            let finish = js(
                &ctx,
                ctx.eval::<Function<'_>, _>(include_str!(concat!(env!("OUT_DIR"), "/web.js"))),
            )?;
            Ok(Persistent::save(&ctx, finish))
        })?;
        let mut page = Self {
            ready: Some(ready),
            context,
            runtime,
            transport,
            url: response.url,
            unhandled_rejections,
        };
        for script in scripts {
            let source = if let Some(src) = script.src {
                let response = page.transport.request(&base, &src, "GET", "")?;
                if !(200..300).contains(&response.status) {
                    return Err(Error::HttpStatus(response.status));
                }
                response.body
            } else {
                script.source
            };
            page.execute(&source)?;
        }
        let ready = page
            .ready
            .take()
            .ok_or_else(|| Error::JavaScript("missing lifecycle callback".into()))?;
        page.context.with(|ctx| -> Result<()> {
            js(&ctx, js(&ctx, ready.restore(&ctx))?.call::<_, ()>(()))
        })?;
        page.drain_jobs()?;
        Ok(page)
    }

    /// URL final após redirects autorizados.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    fn execute(&self, source: &str) -> Result<()> {
        self.transport.check_deadline()?;
        self.context
            .with(|ctx| js(&ctx, ctx.eval::<(), _>(source)))?;
        self.drain_jobs()
    }

    fn drain_jobs(&self) -> Result<()> {
        while self.runtime.is_job_pending() {
            self.transport.check_deadline()?;
            self.runtime
                .execute_pending_job()
                .map_err(|error| Error::JavaScript(format!("microtask failed: {error:?}")))?;
        }
        if self.unhandled_rejections.get() != 0 {
            return Err(Error::JavaScript("unhandled Promise rejection".into()));
        }
        self.transport.check_deadline()
    }

    /// Avalia uma expressão e retorna JSON; aceita resultado Promise.
    /// O deadline original também cobre esta extração.
    ///
    /// # Errors
    /// Retorna erro para JS inválido, Promise rejeitada/pendente, limites ou JSON inválido.
    pub fn evaluate(&self, expression: &str) -> Result<Value> {
        self.transport.check_deadline()?;
        let source =
            format!("Promise.resolve(({expression})).then(value => JSON.stringify(value ?? null))");
        let json = self.context.with(|ctx| -> Result<String> {
            let promise = js(&ctx, ctx.eval::<Promise<'_>, _>(source))?;
            js(&ctx, promise.finish::<String>())
        })?;
        self.drain_jobs()?;
        Ok(serde_json::from_str(&json)?)
    }
}

fn js<T>(ctx: &Ctx<'_>, result: rquickjs::Result<T>) -> Result<T> {
    rquickjs::CaughtError::catch(ctx, result).map_err(|error| Error::JavaScript(error.to_string()))
}

struct Script {
    src: Option<String>,
    source: String,
}

fn collect_scripts(dom: &Dom) -> Result<Vec<Script>> {
    if dom.document.select("iframe, frame, base[href]").exists() {
        return Err(Error::Unsupported("frames and base URL elements".into()));
    }
    let mut scripts = Vec::new();
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
        scripts.push(Script {
            src: node.attr("src").map(|src| src.to_string()),
            source: node.text().to_string(),
        });
    }
    Ok(scripts)
}
