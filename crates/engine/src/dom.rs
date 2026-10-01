use std::collections::HashMap;

use dom_query::{Document, Matcher, NodeId, NodeRef, Selection};
use serde_json::{Value, json};

use crate::{Error, Limits, Result};

pub(crate) struct Dom {
    pub document: Document,
    handles: Vec<NodeId>,
    ids: HashMap<NodeId, usize>,
    operations: usize,
    writes: usize,
    limits: Limits,
}

impl Dom {
    pub(crate) fn new(html: &str, limits: Limits) -> Self {
        let document = Document::from(html);
        let root = document.root().id;
        Self {
            document,
            handles: vec![root],
            ids: HashMap::from([(root, 0)]),
            operations: 0,
            writes: 0,
            limits,
        }
    }

    fn handle(&mut self, id: NodeId) -> usize {
        if let Some(handle) = self.ids.get(&id) {
            return *handle;
        }
        let handle = self.handles.len();
        self.handles.push(id);
        self.ids.insert(id, handle);
        handle
    }

    fn node(&self, handle: usize) -> Result<NodeRef<'_>> {
        self.handles
            .get(handle)
            .and_then(|id| self.document.tree.get(id))
            .ok_or_else(|| Error::Dom("invalid node handle".into()))
    }

    pub(crate) fn call(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<String> {
        self.operations += 1;
        if self.operations > self.limits.max_dom_operations {
            return Err(Error::Limit("DOM operations"));
        }
        let result = match operation {
            "query" => self.query(handle, arg)?,
            "create" => {
                if arg.is_empty()
                    || !arg
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                {
                    return Err(Error::Dom("invalid element name".into()));
                }
                let id = self.document.tree.new_element(&arg.to_ascii_lowercase()).id;
                json!(self.handle(id))
            }
            "get" => self.get(handle, arg)?,
            "attr" => json!(self.node(handle)?.attr(arg).map(|text| text.to_string())),
            "set" | "setAttr" => {
                self.writes = self
                    .writes
                    .saturating_add(arg.len())
                    .saturating_add(value.len());
                if self.writes > self.limits.max_dom_write_bytes {
                    return Err(Error::Limit("DOM write bytes"));
                }
                self.set(operation, handle, arg, value)?;
                Value::Null
            }
            "append" => {
                let child = value
                    .parse::<usize>()
                    .map_err(|error| Error::Dom(error.to_string()))?;
                let parent = self.node(handle)?;
                let child = self.node(child)?;
                if !parent.is_element()
                    || !child.is_element()
                    || parent.id == child.id
                    || parent
                        .ancestors(None)
                        .iter()
                        .any(|ancestor| ancestor.id == child.id)
                {
                    return Err(Error::Dom("invalid append or DOM cycle".into()));
                }
                parent.append_child(&child.id);
                Value::Null
            }
            "remove" => {
                self.node(handle)?.remove_from_parent();
                Value::Null
            }
            _ => {
                return Err(Error::Dom(format!(
                    "unsupported DOM operation: {operation}"
                )));
            }
        };
        Ok(serde_json::to_string(&result)?)
    }

    fn query(&mut self, handle: usize, selector: &str) -> Result<Value> {
        let matcher = Matcher::new(selector)
            .map_err(|error| Error::Dom(format!("invalid selector: {error:?}")))?;
        let ids: Vec<_> = Selection::from(self.node(handle)?)
            .select_matcher(&matcher)
            .nodes()
            .iter()
            .map(|node| node.id)
            .collect();
        Ok(json!(
            ids.into_iter()
                .map(|id| self.handle(id))
                .collect::<Vec<_>>()
        ))
    }

    fn get(&self, handle: usize, property: &str) -> Result<Value> {
        let node = self.node(handle)?;
        Ok(match property {
            "textContent" => json!(node.text().to_string()),
            "innerHTML" => json!(node.inner_html().to_string()),
            "outerHTML" => json!(node.html().to_string()),
            "tagName" => json!(node.node_name().map(|name| name.to_ascii_uppercase())),
            _ => return Err(Error::Dom(format!("unsupported property: {property}"))),
        })
    }

    fn set(&self, operation: &str, handle: usize, property: &str, value: &str) -> Result<()> {
        let node = self.node(handle)?;
        if !node.is_element() {
            return Err(Error::Dom("write target must be an element".into()));
        }
        match (operation, property) {
            ("set", "textContent") => node.set_text(value),
            ("set", "innerHTML") => node.set_html(value),
            ("setAttr", _) => node.set_attr(property, value),
            _ => return Err(Error::Dom(format!("unsupported write: {property}"))),
        }
        Ok(())
    }
}
