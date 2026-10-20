use std::{
    cell::RefCell,
    collections::{HashMap, HashSet, VecDeque},
    rc::Rc,
};

use rquickjs::{
    Context, Ctx, Exception, Function, Module, Persistent, Promise, Runtime,
    loader::{ImportAttributes, Loader, Resolver},
};

use crate::{
    Error, Result,
    machine::{Response, resolve},
};

#[derive(Clone)]
struct Source {
    body: String,
    base: String,
}

struct Preload {
    promise: Persistent<Promise<'static>>,
    resolve: Persistent<Function<'static>>,
    reject: Persistent<Function<'static>>,
}

#[derive(Clone)]
pub(crate) struct Modules {
    sources: Rc<RefCell<HashMap<String, Source>>>,
    missing: Rc<RefCell<Option<String>>>,
    origin: url::Url,
    import_map: Rc<RefCell<crate::import_maps::ImportMap>>,
    preloads: Rc<RefCell<HashMap<String, Preload>>>,
    queue: Rc<RefCell<VecDeque<String>>>,
    prepared: Rc<RefCell<HashSet<String>>>,
}

impl Modules {
    pub(crate) fn new(origin: url::Url) -> Self {
        Self {
            sources: Rc::default(),
            missing: Rc::default(),
            origin,
            import_map: Rc::default(),
            preloads: Rc::default(),
            queue: Rc::default(),
            prepared: Rc::default(),
        }
    }

    pub(crate) fn register_import_map(&self, source: &str, base: &url::Url) -> Result<()> {
        *self.import_map.borrow_mut() = crate::import_maps::ImportMap::parse(source, base)?;
        Ok(())
    }

    pub(crate) fn install(&self, runtime: &Runtime) {
        runtime.set_loader(self.clone(), self.clone());
    }

    pub(crate) fn install_preload<'js>(
        &self,
        ctx: &Ctx<'js>,
        max_pending: usize,
        fatal: Rc<RefCell<Option<Persistent<Function<'static>>>>>,
    ) -> rquickjs::Result<()> {
        let setter: Function<'js> = ctx.globals().get("__quickjsSetModulePreload")?;
        ctx.globals().remove("__quickjsSetModulePreload")?;
        let modules = self.clone();
        let callback = Function::new(ctx.clone(), move |ctx: Ctx<'js>, name: String| {
            modules.preload(&ctx, name, max_pending, &fatal)
        })?;
        setter.call::<_, ()>((callback,))
    }

    fn preload<'js>(
        &self,
        ctx: &Ctx<'js>,
        name: String,
        max_pending: usize,
        fatal: &RefCell<Option<Persistent<Function<'static>>>>,
    ) -> rquickjs::Result<Promise<'js>> {
        if let Some(preload) = self.preloads.borrow().get(&name) {
            return preload.promise.clone().restore(ctx);
        }
        let (promise, resolve, reject) = Promise::new(ctx)?;
        if self.prepared.borrow().contains(&name) {
            resolve.call::<_, ()>(())?;
            return Ok(promise);
        }
        if self.preloads.borrow().len() >= max_pending {
            return Err(crate::machine::host_error(
                ctx,
                fatal,
                &Error::Limit("module preload count"),
            ));
        }
        self.queue.borrow_mut().push_back(name.clone());
        self.preloads.borrow_mut().insert(
            name,
            Preload {
                promise: Persistent::save(ctx, promise.clone()),
                resolve: Persistent::save(ctx, resolve),
                reject: Persistent::save(ctx, reject),
            },
        );
        Ok(promise)
    }

    pub(crate) fn next_preload(&self) -> Option<String> {
        self.queue.borrow().front().cloned()
    }

    pub(crate) fn finish_preload(
        &self,
        ctx: &Ctx<'_>,
        root: &str,
        error: Option<&str>,
    ) -> rquickjs::Result<()> {
        let preload = self.preloads.borrow_mut().remove(root);
        self.queue.borrow_mut().retain(|name| name != root);
        if let Some(preload) = preload {
            if let Some(error) = error {
                Exception::throw_type(ctx, error);
                let reason = ctx.catch();
                return preload.reject.restore(ctx)?.call((reason,));
            }
            self.prepared.borrow_mut().insert(root.to_owned());
            return preload.resolve.restore(ctx)?.call(());
        }
        Ok(())
    }

    pub(crate) fn clear_preloads(&self) {
        self.preloads.borrow_mut().clear();
        self.queue.borrow_mut().clear();
    }

    pub(crate) fn inline(&self, name: String, body: String, base: String) {
        self.sources
            .borrow_mut()
            .insert(name, Source { body, base });
    }

    pub(crate) fn respond(&self, name: String, response: &Response) -> Result<()> {
        if !(200..300).contains(&response.status) {
            return Err(Error::HttpStatus(response.status));
        }
        let mime = response
            .content_type
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            mime.as_str(),
            "application/ecmascript"
                | "application/javascript"
                | "application/x-ecmascript"
                | "application/x-javascript"
                | "text/ecmascript"
                | "text/javascript"
                | "text/javascript1.0"
                | "text/javascript1.1"
                | "text/javascript1.2"
                | "text/javascript1.3"
                | "text/javascript1.4"
                | "text/javascript1.5"
                | "text/jscript"
                | "text/livescript"
                | "text/x-ecmascript"
                | "text/x-javascript"
        ) {
            return Err(Error::Unsupported(
                "module requires JavaScript MIME type".into(),
            ));
        }
        self.inline(name, response.body.clone(), response.url.clone());
        Ok(())
    }

    /// Discover dependencies with the real compiler in a disposable, unexecuted realm.
    /// A failed discovery cannot poison the page's module map or execute side effects.
    pub(crate) fn prepare(&self, runtime: &Runtime, root: &str) -> Result<Option<String>> {
        self.missing.borrow_mut().take();
        let source = self.sources.borrow().get(root).cloned();
        let Some(source) = source else {
            return Ok(Some(root.to_owned()));
        };
        let context = Context::full(runtime).map_err(|error| match error {
            rquickjs::Error::Allocation => Error::Limit("module compilation"),
            error => Error::JavaScript(error.to_string()),
        })?;
        let result = context.with(|ctx| {
            rquickjs::CaughtError::catch(&ctx, Module::declare(ctx.clone(), root, source.body))
                .map(|_| ())
                .map_err(|error| match &error {
                    rquickjs::CaughtError::Exception(exception)
                        if exception.as_object().as_value().is_uncatchable_error() =>
                    {
                        Error::Limit("module compilation")
                    }
                    rquickjs::CaughtError::Error(rquickjs::Error::Allocation) => {
                        Error::Limit("module compilation")
                    }
                    _ => Error::JavaScript(error.to_string()),
                })
        });
        drop(context);
        runtime.run_gc();
        let missing = self.missing.borrow_mut().take();
        match (result, missing) {
            (Err(error @ Error::Limit(_)), _) => Err(error),
            (_, Some(name)) => Ok(Some(name)),
            (result, None) => result.map(|()| None),
        }
    }

    pub(crate) fn evaluate<'js>(
        &self,
        ctx: &Ctx<'js>,
        root: &str,
    ) -> rquickjs::Result<Promise<'js>> {
        let source = self
            .sources
            .borrow()
            .get(root)
            .cloned()
            .ok_or_else(|| Exception::throw_type(ctx, "missing module source"))?;
        let module = Module::declare(ctx.clone(), root, source.body)?;
        module.meta()?.set("url", source.base)?;
        module.eval().map(|(_, promise)| promise)
    }
}

impl Resolver for Modules {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if attributes.is_some_and(|attributes| attributes.keys().next().is_some()) {
            return Err(Exception::throw_type(
                ctx,
                "import attributes are not implemented",
            ));
        }
        let source_base = self
            .sources
            .borrow()
            .get(base)
            .map_or_else(|| base.to_owned(), |source| source.base.clone());
        let base = url::Url::parse(&source_base)
            .map_err(|error| Exception::throw_type(ctx, &error.to_string()))?;
        let resolved = self
            .import_map
            .borrow()
            .resolve(name, &base)
            .map_err(|error| Exception::throw_type(ctx, &error.to_string()))?;
        resolve(&self.origin, resolved.as_str())
            .map(|url| url.to_string())
            .map_err(|error| Exception::throw_type(ctx, &error.to_string()))
    }
}

impl Loader for Modules {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js>> {
        let source = self.sources.borrow().get(name).cloned();
        let Some(source) = source else {
            *self.missing.borrow_mut() = Some(name.to_owned());
            return Err(Exception::throw_type(ctx, "module source is not loaded"));
        };
        let module = Module::declare(ctx.clone(), name, source.body)?;
        module.meta()?.set("url", source.base)?;
        Ok(module)
    }
}
