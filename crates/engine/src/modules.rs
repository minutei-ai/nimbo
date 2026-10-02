use std::{cell::RefCell, collections::HashMap, rc::Rc};

use rquickjs::{
    Context, Ctx, Exception, Module, Runtime,
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

#[derive(Clone)]
pub(crate) struct Modules {
    sources: Rc<RefCell<HashMap<String, Source>>>,
    missing: Rc<RefCell<Option<String>>>,
    origin: url::Url,
}

impl Modules {
    pub(crate) fn new(origin: url::Url) -> Self {
        Self {
            sources: Rc::default(),
            missing: Rc::default(),
            origin,
        }
    }

    pub(crate) fn install(&self, runtime: &Runtime) {
        runtime.set_loader(self.clone(), self.clone());
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
        let context =
            Context::full(runtime).map_err(|error| Error::JavaScript(error.to_string()))?;
        let result = context.with(|ctx| {
            rquickjs::CaughtError::catch(&ctx, Module::declare(ctx.clone(), root, source.body))
                .map(|_| ())
                .map_err(|error| Error::JavaScript(error.to_string()))
        });
        drop(context);
        runtime.run_gc();
        if let Some(name) = self.missing.borrow_mut().take() {
            return Ok(Some(name));
        }
        result.map(|()| None)
    }

    pub(crate) fn evaluate<'js>(
        &self,
        ctx: &Ctx<'js>,
        root: &str,
    ) -> rquickjs::Result<rquickjs::Promise<'js>> {
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
        if !name.starts_with('/')
            && !name.starts_with("./")
            && !name.starts_with("../")
            && url::Url::parse(name).is_err()
        {
            return Err(Exception::throw_type(
                ctx,
                "bare module specifier requires an import map",
            ));
        }
        let source_base = self
            .sources
            .borrow()
            .get(base)
            .map_or_else(|| base.to_owned(), |source| source.base.clone());
        let base = url::Url::parse(&source_base)
            .map_err(|error| Exception::throw_type(ctx, &error.to_string()))?;
        let resolved = base
            .join(name)
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
