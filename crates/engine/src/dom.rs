use std::collections::HashMap;

use dom_query::{Document, Matcher, NodeId, NodeRef, Selection};
use serde_json::{Value, json};

use crate::{Error, Limits, Result};

pub(crate) struct Dom {
    pub document: Document,
    handles: Vec<NodeId>,
    ids: HashMap<NodeId, usize>,
    // Cache compiled selectors only; DOM results must always reflect mutations.
    matchers: HashMap<String, Matcher>,
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
            matchers: HashMap::new(),
            operations: 0,
            writes: 0,
            limits,
        }
    }

    fn handle(&mut self, id: NodeId) -> usize {
        register_handle(&mut self.handles, &mut self.ids, id)
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
        if self.operations >= self.limits.max_dom_operations {
            return Err(Error::Limit("DOM operations"));
        }
        self.operations = self.operations.saturating_add(1);
        let result = match operation {
            "query" => self.query(handle, arg)?,
            "queryOne" => self.query_one(handle, arg)?,
            "matches" => {
                let matcher = self.matcher(arg)?;
                json!(self.node(handle)?.is_match(&matcher))
            }
            "closest" => {
                let matcher = self.matcher(arg)?;
                let node = self.node(handle)?;
                let id = std::iter::once(node)
                    .chain(node.ancestors_it(None))
                    .find(|candidate| candidate.is_element() && candidate.is_match(&matcher))
                    .map(|candidate| candidate.id);
                json!(id.map(|id| self.handle(id)))
            }
            "parentElement" => {
                let id = self
                    .node(handle)?
                    .parent()
                    .filter(NodeRef::is_element)
                    .map(|parent| parent.id);
                json!(id.map(|id| self.handle(id)))
            }
            "relativeElement" => self.relative_element(handle, arg)?,
            "contains" => {
                let descendant = arg
                    .parse::<usize>()
                    .map_err(|error| Error::Dom(error.to_string()))?;
                let parent = self.node(handle)?;
                let descendant = self.node(descendant)?;
                json!(
                    parent.id == descendant.id
                        || descendant
                            .ancestors_it(None)
                            .any(|ancestor| ancestor.id == parent.id)
                )
            }
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
            "set" | "setAttr" | "removeAttr" => {
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
        let matcher = self.matcher(selector)?;
        let id = self
            .handles
            .get(handle)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let node = self
            .document
            .tree
            .get(id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let handles = &mut self.handles;
        let ids = &mut self.ids;
        let selection = Selection::from(node);
        let result: Vec<_> = selection
            .select_matcher_iter(&matcher)
            .map(|node| register_handle(handles, ids, node.id))
            .collect();
        Ok(json!(result))
    }

    fn relative_element(&mut self, handle: usize, relation: &str) -> Result<Value> {
        let node = self.node(handle)?;
        let relative = match relation {
            "first" => node.children_it(false).find(NodeRef::is_element),
            "last" => node.children_it(true).find(NodeRef::is_element),
            "next" => std::iter::successors(node.next_sibling(), NodeRef::next_sibling)
                .find(NodeRef::is_element),
            "previous" => std::iter::successors(node.prev_sibling(), NodeRef::prev_sibling)
                .find(NodeRef::is_element),
            _ => return Err(Error::Dom("invalid element relation".into())),
        };
        let id = relative.map(|relative| relative.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn query_one(&mut self, handle: usize, selector: &str) -> Result<Value> {
        let matcher = self.matcher(selector)?;
        let selection = Selection::from(self.node(handle)?);
        let id = selection
            .select_matcher_iter(&matcher)
            .next()
            .map(|node| node.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn matcher(&mut self, selector: &str) -> Result<Matcher> {
        if let Some(matcher) = self.matchers.get(selector) {
            return Ok(matcher.clone());
        }
        let matcher = Matcher::new(selector)
            .map_err(|error| Error::Dom(format!("invalid selector: {error:?}")))?;
        // Bound retained keys and parser structures without restricting valid selectors.
        if self.matchers.len() < 64 && selector.len() <= 512 {
            self.matchers.insert(selector.to_owned(), matcher.clone());
        }
        Ok(matcher)
    }

    fn get(&self, handle: usize, property: &str) -> Result<Value> {
        let node = self.node(handle)?;
        Ok(match property {
            "textContent" => json!(node.text().to_string()),
            "innerHTML" => json!(node.inner_html().to_string()),
            "outerHTML" => json!(node.html().to_string()),
            "tagName" => json!(node.node_name().map(|name| name.to_ascii_uppercase())),
            "isConnected" => json!(
                node.is_document()
                    || node
                        .ancestors_it(None)
                        .any(|ancestor| ancestor.is_document())
            ),
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
            ("removeAttr", _) => node.remove_attr(property),
            _ => return Err(Error::Dom(format!("unsupported write: {property}"))),
        }
        Ok(())
    }
}

fn register_handle(
    handles: &mut Vec<NodeId>,
    ids: &mut HashMap<NodeId, usize>,
    id: NodeId,
) -> usize {
    *ids.entry(id).or_insert_with(|| {
        let handle = handles.len();
        handles.push(id);
        handle
    })
}
