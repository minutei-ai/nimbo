use super::Dom;
use crate::{Error, Result, dom_attributes::NativeAttributes};
use dom_query::{Document, NodeId, NodeRef};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
};
use url::Url;

const ENTRIES: usize = 128;
const STATE_BYTES: usize = 64 * 1024;
const URL_BYTES: usize = 4096;
const TOTAL_BYTES: usize = 1024 * 1024;

struct Entry {
    url: Url,
    // The page's owned codec preserves graph identity and UTF-16 in this opaque wire value.
    state: String,
}
impl Entry {
    fn bytes(&self) -> usize {
        self.url.as_str().len().saturating_add(self.state.len())
    }
}

struct Base {
    href: String,
    url: String,
}
pub(super) struct Arena {
    current: Entry,
    past: Vec<Entry>,
    future: Vec<Entry>,
    bytes: usize,
    active: bool,
    bases: RefCell<HashMap<NodeId, Base>>,
    first_base: Cell<Option<NodeId>>,
    base_dirty: Cell<bool>,
    pub(super) work: Cell<usize>,
}
impl Arena {
    pub(super) fn new(url: Url) -> Self {
        let current = Entry {
            url,
            state: String::new(),
        };
        let bytes = current.bytes();
        Self {
            current,
            past: Vec::new(),
            future: Vec::new(),
            bytes,
            active: false,
            bases: RefCell::default(),
            first_base: Cell::new(None),
            base_dirty: Cell::new(true),
            work: Cell::new(0),
        }
    }
    pub(super) fn url(&self) -> &Url {
        &self.current.url
    }
    fn base_href(
        &self,
        document: &Document,
        may_have_bases: bool,
        budget: usize,
        max_nodes: usize,
    ) -> Result<Option<String>> {
        if !self.active {
            return Ok(raw_base(document));
        }
        self.refresh_bases(document, may_have_bases, budget, max_nodes)?;
        Ok(Some(
            self.first_base
                .get()
                .and_then(|id| self.bases.borrow().get(&id).map(|base| base.url.clone()))
                .unwrap_or_else(|| self.url().to_string()),
        ))
    }
    fn refresh_bases(
        &self,
        document: &Document,
        may_have_bases: bool,
        budget: usize,
        max_nodes: usize,
    ) -> Result<()> {
        if !self.base_dirty.get() {
            return Ok(());
        }
        let mut spent = self.work.get();
        let result = (|| {
            let mut work = crate::layout::Work::new(&mut spent, budget, max_nodes);
            let mut next = HashMap::new();
            let previous = self.bases.borrow();
            let mut first = None;
            if may_have_bases {
                for node in document.root().descendants_it() {
                    work.charge()?;
                    if !is_base(node) {
                        continue;
                    }
                    let Some(href) = node.null_attribute("href") else {
                        continue;
                    };
                    if next.len() >= ENTRIES {
                        return Err(Error::Limit("base URL entries"));
                    }
                    let url = previous
                        .get(&node.id)
                        .filter(|base| base.href == href)
                        .map_or_else(
                            || {
                                crate::links::base(Some(&href), self.url().as_str())
                                    .unwrap_or_else(|| self.url().clone())
                                    .to_string()
                            },
                            |base| base.url.clone(),
                        );
                    first.get_or_insert(node.id);
                    next.insert(node.id, Base { href, url });
                }
            }
            drop(previous);
            *self.bases.borrow_mut() = next;
            self.first_base.set(first);
            self.base_dirty.set(false);
            Ok(())
        })();
        self.work.set(spent);
        result
    }
    fn reset_subtree(
        &self,
        node: NodeRef<'_>,
        document: &Document,
        budget: usize,
        max_nodes: usize,
    ) -> Result<bool> {
        let mut spent = self.work.get();
        let result = (|| {
            let mut work = crate::layout::Work::new(&mut spent, budget, max_nodes);
            let mut reset = Vec::new();
            for child in std::iter::once(node).chain(node.descendants_it()) {
                work.charge()?;
                if is_base(child)
                    && (self.bases.borrow().contains_key(&child.id) || in_document(child, document))
                {
                    reset.push(child.id);
                }
            }
            let changed = !reset.is_empty();
            for id in reset {
                self.bases.borrow_mut().remove(&id);
            }
            if changed {
                self.base_dirty.set(true);
            }
            Ok(changed)
        })();
        self.work.set(spent);
        result
    }
    fn length(&self) -> usize {
        self.past
            .len()
            .saturating_add(self.future.len())
            .saturating_add(1)
    }
    fn snapshot(&self) -> Value {
        json!({"url":self.current.url.as_str(),"state":self.current.state,"length":self.length()})
    }
    fn write(&mut self, push: bool, state: String, target: Option<&str>, base: &Url) -> Result<()> {
        if state.len() > STATE_BYTES {
            return Err(Error::Limit("history state bytes"));
        }
        if target.is_some_and(|value| value.len() > URL_BYTES) {
            return Err(Error::Limit("history URL bytes"));
        }
        let url = match target.filter(|value| !value.is_empty()) {
            Some(value) => base.join(value).map_err(|_error| rewrite_error())?,
            None => self.current.url.clone(),
        };
        if !rewritable(&self.current.url, &url) {
            return Err(rewrite_error());
        }
        let entry = Entry { url, state };
        let retained = if push {
            if self.past.len().saturating_add(2) > ENTRIES {
                return Err(Error::Limit("history entries"));
            }
            self.past.iter().fold(self.current.bytes(), |bytes, entry| {
                bytes.saturating_add(entry.bytes())
            })
        } else {
            self.bytes.saturating_sub(self.current.bytes())
        };
        let bytes = retained.saturating_add(entry.bytes());
        if bytes > TOTAL_BYTES {
            return Err(Error::Limit("history total bytes"));
        }
        let previous = std::mem::replace(&mut self.current, entry);
        if push {
            self.past.push(previous);
            self.future.clear();
        }
        self.bytes = bytes;
        Ok(())
    }
    fn travel(&mut self, delta: i32) -> Result<bool> {
        if delta == 0 {
            return Err(Error::DomException {
                name: "NotSupportedError",
                message: "history reload is not implemented",
            });
        }
        let steps = usize::try_from(delta.unsigned_abs())
            .map_err(|_error| Error::Limit("history traversal"))?;
        let (source, destination) = if delta < 0 {
            (&mut self.past, &mut self.future)
        } else {
            (&mut self.future, &mut self.past)
        };
        if steps > source.len() {
            return Ok(false);
        }
        for _ in 0..steps {
            let entry = source
                .pop()
                .ok_or_else(|| Error::Dom("invalid history traversal".into()))?;
            destination.push(std::mem::replace(&mut self.current, entry));
        }
        Ok(true)
    }
}
fn is_base(node: NodeRef<'_>) -> bool {
    node.has_name("base") && node.query_or(false,|node|matches!(&node.data,dom_query::NodeData::Element(element) if element.name.ns.as_ref()=="http://www.w3.org/1999/xhtml"))
}
fn in_document(node: NodeRef<'_>, document: &Document) -> bool {
    node.ancestors_it(None)
        .any(|parent| parent.id == document.root().id)
}
fn raw_base(document: &Document) -> Option<String> {
    document
        .root()
        .descendants_it()
        .find(|node| is_base(*node) && node.null_attribute("href").is_some())
        .and_then(|node| node.null_attribute("href"))
}
fn rewritable(current: &Url, target: &Url) -> bool {
    matches!(target.scheme(), "http" | "https")
        && current.scheme() == target.scheme()
        && current.username() == target.username()
        && current.password() == target.password()
        && current.host_str() == target.host_str()
        && current.port() == target.port()
}
fn rewrite_error() -> Error {
    Error::DomException {
        name: "SecurityError",
        message: "history URL rewrite is forbidden",
    }
}
impl Dom {
    pub(crate) fn base_href(&self) -> Result<Option<String>> {
        self.history.base_href(
            &self.document,
            self.may_have_bases,
            self.limits
                .max_dom_operations
                .saturating_sub(self.operations),
            self.limits.max_layout_nodes,
        )
    }
    fn history_reset_href(&self, handle: usize) -> Result<bool> {
        let node = self.node(handle)?;
        if !is_base(node) || !in_document(node, &self.document) {
            return Ok(false);
        }
        self.history.bases.borrow_mut().remove(&node.id);
        self.history.base_dirty.set(true);
        Ok(true)
    }
    pub(super) fn history_base_mutation(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<()> {
        if !self.history.active || !self.may_have_bases {
            return Ok(());
        }
        let mut changed = false;
        let previous = self.history.first_base.get();
        match operation {
            "setAttr" | "removeAttr" => {
                let node = self.node(handle)?;
                if arg == "href"
                    || (self.html_document(node.id) && arg.eq_ignore_ascii_case("href"))
                {
                    changed = self.history_reset_href(handle)?;
                }
            }
            "setAttrNS" | "removeAttrNS" => {
                let [namespace, name]: [String; 2] = serde_json::from_str(arg)?;
                if namespace.is_empty() && name == "href" {
                    changed = self.history_reset_href(handle)?;
                }
            }
            "append" | "insert" | "replace" => {
                let child = value
                    .parse::<usize>()
                    .map_err(|error| Error::Dom(error.to_string()))?;
                changed = self.history.reset_subtree(
                    self.node(child)?,
                    &self.document,
                    self.limits
                        .max_dom_operations
                        .saturating_sub(self.operations),
                    self.limits.max_layout_nodes,
                )?;
                self.history.base_dirty.set(true);
            }
            "remove" | "removeChild" => {
                self.history.base_dirty.set(true);
            }
            "set" if matches!(arg, "innerHTML" | "textContent") => {
                self.history.base_dirty.set(true);
            }
            _ => {}
        }
        if self.history.base_dirty.get() {
            self.base_href()?;
        }
        if changed || previous != self.history.first_base.get() {
            self.sheets.unfreeze_urls();
        }
        Ok(())
    }
    pub(super) fn history_call(&mut self, operation: &str, value: &str) -> Result<Value> {
        match operation {
            "get" => Ok(self.history.snapshot()),
            "length" => Ok(json!(self.history.length())),
            "push" | "replace" => {
                self.history.active = true;
                self.base_href()?;
                if value.len() > STATE_BYTES.saturating_add(URL_BYTES).saturating_mul(6) {
                    return Err(Error::Limit("history input bytes"));
                }
                let (state, target): (String, Option<String>) = serde_json::from_str(value)?;
                let base =
                    crate::links::base(self.base_href()?.as_deref(), self.history.url().as_str())
                        .unwrap_or_else(|| self.history.url().clone());
                self.history
                    .write(operation == "push", state, target.as_deref(), &base)?;
                self.sheets.freeze_urls();
                Ok(self.history.snapshot())
            }
            "travel" => {
                self.history.active = true;
                self.base_href()?;
                let delta: i32 = serde_json::from_str(value)?;
                if self.history.travel(delta)? {
                    self.sheets.freeze_urls();
                    Ok(self.history.snapshot())
                } else {
                    Ok(Value::Null)
                }
            }
            _ => Err(Error::Dom("invalid history operation".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Arena, ENTRIES, STATE_BYTES, TOTAL_BYTES, URL_BYTES};
    use crate::Error;
    use url::Url;
    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn writes_traverse_and_discard_forward_branches() -> TestResult {
        let base = Url::parse("https://example.test/start")?;
        let mut arena = Arena::new(base.clone());
        arena.write(false, "initial".into(), None, &base)?;
        arena.write(true, "one".into(), Some("/one"), &base)?;
        arena.write(true, "two".into(), Some("/two"), &base)?;
        assert_eq!(arena.length(), 3);
        assert!(arena.travel(-2)?);
        assert_eq!(arena.current.state, "initial");
        assert!(arena.travel(1)?);
        assert_eq!(arena.url().path(), "/one");
        arena.write(true, "branch".into(), Some("/branch"), &base)?;
        assert_eq!(arena.length(), 3);
        assert!(!arena.travel(1)?);
        assert!(!arena.travel(i32::MIN)?);
        assert!(arena.travel(-1)?);
        assert_eq!(arena.current.state, "one");
        Ok(())
    }
    #[test]
    fn failed_writes_preserve_url_state_and_capacity() -> TestResult {
        let base = Url::parse("https://example.test/start?query#fragment")?;
        let mut arena = Arena::new(base.clone());
        for target in [
            "https://other.test/",
            "http://example.test/",
            "https://user@example.test/",
            "https://example.test:444/",
            "http://[",
        ] {
            assert!(matches!(
                arena.write(true, "bad".into(), Some(target), &base),
                Err(Error::DomException {
                    name: "SecurityError",
                    ..
                })
            ));
            assert_eq!(arena.length(), 1);
            assert_eq!(arena.url(), &base);
        }
        arena.write(
            false,
            "empty URL".into(),
            Some(""),
            &Url::parse("https://example.test/ignored/")?,
        )?;
        assert_eq!(arena.url(), &base);
        assert!(matches!(
            arena.write(true, "x".repeat(STATE_BYTES.saturating_add(1)), None, &base),
            Err(Error::Limit("history state bytes"))
        ));
        assert!(matches!(
            arena.write(
                true,
                String::new(),
                Some(&"x".repeat(URL_BYTES.saturating_add(1))),
                &base
            ),
            Err(Error::Limit("history URL bytes"))
        ));
        assert_eq!(arena.current.state, "empty URL");
        Ok(())
    }
    #[test]
    fn independent_retention_limits_release_forward_states() -> TestResult {
        let base = Url::parse("https://example.test/")?;
        let mut arena = Arena::new(base.clone());
        for _ in 1..ENTRIES {
            arena.write(true, String::new(), None, &base)?;
        }
        assert!(matches!(
            arena.write(true, String::new(), None, &base),
            Err(Error::Limit("history entries"))
        ));
        assert!(arena.travel(-127)?);
        arena.write(true, "branch".into(), None, &base)?;
        assert_eq!(arena.length(), 2);
        for _ in 0..16 {
            if arena
                .write(true, "x".repeat(STATE_BYTES), None, &base)
                .is_err()
            {
                break;
            }
        }
        assert!(arena.bytes <= TOTAL_BYTES);
        assert!(matches!(
            arena.write(true, "x".repeat(STATE_BYTES), None, &base),
            Err(Error::Limit("history total bytes"))
        ));
        assert!(arena.travel(-1)?);
        arena.write(true, "small".into(), None, &base)?;
        assert!(!arena.travel(1)?);
        Ok(())
    }
    fn node(
        dom: &mut crate::dom::Dom,
        selector: &str,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        let value: serde_json::Value =
            serde_json::from_str(&dom.call("queryOne", 0, selector, "")?)?;
        Ok(usize::try_from(
            value.as_u64().ok_or("missing fixture node")?,
        )?)
    }
    #[test]
    fn document_bases_freeze_across_history_and_refresh_on_real_mutations() -> TestResult {
        let origin = Url::parse("https://example.test/original/page")?;
        let mut dom = crate::dom::Dom::new(
            "<head><base id=first href=frozen/><base id=second href=other/></head><body>",
            crate::Limits::default(),
            crate::MediaEnvironment::default(),
            origin,
            &|| Ok(()),
        )?;
        dom.call("history", 0, "push", r#"["state","/new/page"]"#)?;
        assert_eq!(
            dom.base_href()?.as_deref(),
            Some("https://example.test/original/frozen/")
        );
        let first = node(&mut dom, "#first")?;
        dom.call("setAttr", first, "href", "frozen/")?;
        assert_eq!(
            dom.base_href()?.as_deref(),
            Some("https://example.test/new/frozen/")
        );
        dom.call("remove", first, "", "")?;
        assert_eq!(
            dom.base_href()?.as_deref(),
            Some("https://example.test/original/other/")
        );
        let second = node(&mut dom, "#second")?;
        dom.call("remove", second, "", "")?;
        assert_eq!(
            dom.base_href()?.as_deref(),
            Some("https://example.test/new/page")
        );
        Ok(())
    }
    #[test]
    fn existing_stylesheets_keep_their_url_while_new_resources_use_current_document() -> TestResult
    {
        let origin = Url::parse("https://example.test/original/page")?;
        let mut dom = crate::dom::Dom::new(
            "<head><link rel=stylesheet href=style.css></head><body>",
            crate::Limits::default(),
            crate::MediaEnvironment::default(),
            origin,
            &|| Ok(()),
        )?;
        let (link, url) = dom.next_sheet()?.ok_or("missing stylesheet")?;
        assert_eq!(url, "https://example.test/original/style.css");
        dom.sheet_response(link, url, None)?;
        dom.call("history", 0, "push", r#"["state","/next/page"]"#)?;
        assert!(dom.next_sheet()?.is_none());
        assert_eq!(dom.document_url().path(), "/next/page");
        dom.call("setAttr", link, "href", "new.css")?;
        let (_, url) = dom.next_sheet()?.ok_or("missing changed stylesheet")?;
        assert_eq!(url, "https://example.test/next/new.css");
        Ok(())
    }
}
