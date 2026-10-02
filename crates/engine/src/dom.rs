use std::collections::HashMap;

use dom_query::{Document, Matcher, NodeData, NodeId, NodeRef, Selection};
use serde_json::{Value, json};

use crate::{Error, Limits, Result};

pub(crate) struct Dom {
    pub document: Document,
    handles: Vec<NodeId>,
    ids: HashMap<NodeId, usize>,
    // Cache compiled selectors only; DOM results must always reflect mutations.
    matchers: HashMap<String, Matcher>,
    styles: HashMap<NodeId, crate::styles::Declarations>,
    style_bytes: usize,
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
            styles: HashMap::new(),
            style_bytes: 0,
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
            "baseHref" => json!(self.base_href()),
            "query" => self.query(handle, arg)?,
            "customCandidates" => self.custom_candidates(handle, arg)?,
            "queryOne" => self.query_one(handle, arg)?,
            "children" => self.children(handle, arg)?,
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
            "relativeNode" => self.relative_node(handle, arg)?,
            "createText" | "createComment" => self.create_character(operation, value)?,
            "createFragment" => {
                let id = self.document.tree.create_node(NodeData::Fragment);
                json!(self.handle(id))
            }
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
                if !valid_element_name(arg) {
                    return Err(Error::DomException {
                        name: "InvalidCharacterError",
                        message: "invalid element name",
                    });
                }
                self.charge_write(arg.len())?;
                let id = self.document.tree.new_element(&arg.to_ascii_lowercase()).id;
                json!(self.handle(id))
            }
            "get" => self.get(handle, arg)?,
            "attributes" => json!(
                self.node(handle)?
                    .attrs()
                    .into_iter()
                    .map(|attribute| (
                        attribute.name.local.to_string(),
                        attribute.value.to_string(),
                        if attribute.name.ns.is_empty() {
                            None
                        } else {
                            Some(attribute.name.ns.to_string())
                        }
                    ))
                    .collect::<Vec<_>>()
            ),
            "attr" => json!(self.node(handle)?.attr(arg).map(|text| text.to_string())),
            "style" => self.style(handle, arg, value)?,
            "set" | "setAttr" | "removeAttr" => {
                self.write_value(operation, handle, arg, value)?;
                Value::Null
            }
            "append" | "insert" | "replace" => self.insert(operation, handle, arg, value)?,
            "removeChild" => self.remove_child(handle, value)?,
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

    fn write_value(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<()> {
        let style_changed = arg.eq_ignore_ascii_case("style")
            && (operation == "removeAttr"
                || (operation == "setAttr"
                    && self.node(handle)?.attr("style").as_deref() != Some(value)));
        let attribute_bytes = if operation == "setAttr" { arg.len() } else { 0 };
        self.charge_write(attribute_bytes.saturating_add(value.len()))?;
        self.set(operation, handle, arg, value)?;
        if style_changed {
            let id = self.node(handle)?.id;
            if let Some(previous) = self.styles.remove(&id) {
                self.style_bytes = self.style_bytes.saturating_sub(previous.bytes());
            }
        }
        Ok(())
    }

    fn style(&mut self, handle: usize, operation: &str, request: &str) -> Result<Value> {
        const STATE_LIMIT: usize = 4 * 1024 * 1024;
        let node = self.node(handle)?;
        if !node.is_element() {
            return Err(Error::Dom("style owner must be an element".into()));
        }
        let id = node.id;
        let mut state = if operation == "text" {
            crate::styles::Declarations::default()
        } else if let Some(state) = self.styles.get(&id) {
            state.clone()
        } else {
            crate::styles::Declarations::parse(node.attr("style").as_deref().unwrap_or_default())
                .map_err(|message| Error::Dom(message.into()))?
        };
        let output = crate::styles::call(&mut state, operation, request)
            .map_err(|message| Error::Dom(message.into()))?;
        state.compact();
        let bytes = self
            .style_bytes
            .saturating_sub(
                self.styles
                    .get(&id)
                    .map_or(0, crate::styles::Declarations::bytes),
            )
            .saturating_add(state.bytes());
        if bytes > STATE_LIMIT {
            return Err(Error::Limit("CSS state"));
        }
        if operation == "text" || output.changed {
            self.charge_write("style".len().saturating_add(output.css_text.len()))?;
            self.set("setAttr", handle, "style", &output.css_text)?;
        }
        self.styles.insert(id, state);
        self.style_bytes = bytes;
        Ok(serde_json::to_value(output)?)
    }

    pub(crate) fn base_href(&self) -> Option<String> {
        self.document
            .root()
            .descendants_it()
            .find(|node| {
                node.query_or(false, |node| {
                    matches!(&node.data, NodeData::Element(element)
                if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml"
                    && element.name.local.as_ref() == "base")
                }) && node.has_attr("href")
            })
            .and_then(|node| node.attr("href").map(|value| value.to_string()))
    }

    fn remove_child(&self, handle: usize, value: &str) -> Result<Value> {
        let child = value
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        let parent = self.node(handle)?;
        let child = self.node(child)?;
        if child.parent().map(|node| node.id) != Some(parent.id) {
            return Err(not_found());
        }
        child.remove_from_parent();
        Ok(Value::Null)
    }

    fn insert(&self, operation: &str, handle: usize, arg: &str, value: &str) -> Result<Value> {
        let child = self.node(
            value
                .parse()
                .map_err(|error: std::num::ParseIntError| Error::Dom(error.to_string()))?,
        )?;
        let parent = self.node(handle)?;
        if !(parent.is_element() || parent.is_fragment() || parent.is_document())
            || !(child.is_element()
                || child.is_text()
                || child.is_comment()
                || child.is_fragment()
                || child.is_doctype())
            || parent.id == child.id
            || parent
                .ancestors_it(None)
                .any(|ancestor| ancestor.id == child.id)
        {
            return Err(hierarchy_error());
        }
        let reference = if arg.is_empty() {
            None
        } else {
            Some(
                self.node(
                    arg.parse()
                        .map_err(|error: std::num::ParseIntError| Error::Dom(error.to_string()))?,
                )?,
            )
        };
        if reference.is_some_and(|node| node.parent().map(|node| node.id) != Some(parent.id)) {
            return Err(not_found());
        }
        let removed = if operation == "replace" {
            reference
        } else {
            None
        };
        if operation == "replace" && removed.is_none() {
            return Err(not_found());
        }
        let mut reference = if operation == "replace" {
            reference.and_then(|node| node.next_sibling())
        } else {
            reference
        };
        if reference.is_some_and(|node| node.id == child.id) {
            reference = child.next_sibling();
        }
        let inserted = if child.is_fragment() {
            child.children()
        } else {
            vec![child]
        };
        validate_insertion(parent, &inserted, reference, removed)?;
        for node in inserted {
            if let Some(reference) = reference {
                reference.insert_before(&node.id);
            } else {
                parent.append_child(&node.id);
            }
        }
        if let Some(removed) = removed.filter(|node| node.id != child.id) {
            removed.remove_from_parent();
        }
        Ok(Value::Null)
    }

    fn create_character(&mut self, operation: &str, value: &str) -> Result<Value> {
        self.charge_write(value.len())?;
        let id = if operation == "createText" {
            self.document.tree.new_text(value).id
        } else {
            self.document.tree.create_node(NodeData::Comment {
                contents: value.into(),
            })
        };
        Ok(json!(self.handle(id)))
    }

    fn charge_write(&mut self, bytes: usize) -> Result<()> {
        self.writes = self.writes.saturating_add(bytes);
        if self.writes > self.limits.max_dom_write_bytes {
            return Err(Error::Limit("DOM write bytes"));
        }
        Ok(())
    }

    fn relative_node(&mut self, handle: usize, relation: &str) -> Result<Value> {
        let node = self.node(handle)?;
        let relative = match relation {
            "parent" => node.parent(),
            "first" => node.first_child(),
            "last" => node.last_child(),
            "next" => node.next_sibling(),
            "previous" => node.prev_sibling(),
            _ => return Err(Error::Dom("invalid node relation".into())),
        };
        let id = relative.map(|relative| relative.id);
        Ok(json!(id.map(|id| self.handle(id))))
    }

    fn custom_candidates(&mut self, handle: usize, name: &str) -> Result<Value> {
        let root = self.node(handle)?;
        let candidates: Vec<_> = std::iter::once(root)
            .chain(root.descendants_it())
            .filter_map(|node| {
                node.query_or(None, |node| match &node.data {
                    NodeData::Element(element)
                        if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml"
                            && element.name.local.contains('-')
                            && (name.is_empty() || element.name.local.as_ref() == name) =>
                    {
                        Some(node.id)
                    }
                    _ => None,
                })
            })
            .collect();
        Ok(json!(
            candidates
                .into_iter()
                .map(|id| self.handle(id))
                .collect::<Vec<_>>()
        ))
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

    fn children(&mut self, handle: usize, kind: &str) -> Result<Value> {
        if !matches!(kind, "nodes" | "elements") {
            return Err(Error::Dom("invalid child collection".into()));
        }
        let id = self
            .handles
            .get(handle)
            .copied()
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid node handle".into()))?;
        let handles = &mut self.handles;
        let ids = &mut self.ids;
        let result: Vec<_> = node
            .children_it(false)
            .filter(|node| kind == "nodes" || node.is_element())
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
            "textContent" => {
                if node.is_document() || node.is_doctype() {
                    Value::Null
                } else if node.is_comment() {
                    character_value(node)
                } else {
                    json!(node.text().to_string())
                }
            }
            "nodeValue" => character_value(node),
            "nodeType" => node.query_or(Value::Null, |node| match node.data {
                NodeData::Element(_) => json!(1),
                NodeData::Text { .. } => json!(3),
                NodeData::ProcessingInstruction { .. } => json!(7),
                NodeData::Comment { .. } => json!(8),
                NodeData::Document => json!(9),
                NodeData::Doctype { .. } => json!(10),
                NodeData::Fragment => json!(11),
            }),
            "nodeName" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(if element.name.ns.as_ref()
                    == "http://www.w3.org/1999/xhtml"
                {
                    element.node_name().to_ascii_uppercase()
                } else {
                    element.node_name().to_string()
                }),
                NodeData::Text { .. } => json!("#text"),
                NodeData::Comment { .. } => json!("#comment"),
                NodeData::Document => json!("#document"),
                NodeData::Fragment => json!("#document-fragment"),
                NodeData::Doctype { name, .. } => json!(name.to_string()),
                NodeData::ProcessingInstruction { target, .. } => json!(target.to_string()),
            }),
            "innerHTML" => json!(node.inner_html().to_string()),
            "outerHTML" => json!(node.html().to_string()),
            "tagName" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(if element.name.ns.as_ref()
                    == "http://www.w3.org/1999/xhtml"
                {
                    element.node_name().to_ascii_uppercase()
                } else {
                    element.node_name().to_string()
                }),
                _ => Value::Null,
            }),
            "localName" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(element.name.local.to_string()),
                _ => Value::Null,
            }),
            "namespaceURI" => node.query_or(Value::Null, |node| match &node.data {
                NodeData::Element(element) => json!(element.name.ns.to_string()),
                _ => Value::Null,
            }),
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
        if operation == "set" && matches!(property, "textContent" | "nodeValue") {
            if node.is_text() || node.is_comment() {
                node.update(|node| match &mut node.data {
                    NodeData::Text { contents } | NodeData::Comment { contents } => {
                        *contents = value.into();
                    }
                    _ => {}
                });
                return Ok(());
            }
            if property == "nodeValue" || node.is_document() || node.is_doctype() {
                return Ok(());
            }
        }
        if operation == "set"
            && property == "textContent"
            && (node.is_element() || node.is_fragment())
        {
            node.remove_children();
            if !value.is_empty() {
                let text = self.document.tree.new_text(value);
                node.append_child(&text.id);
            }
            return Ok(());
        }
        if !node.is_element() {
            return Err(Error::Dom("write target must be an element".into()));
        }
        match (operation, property) {
            ("set", "innerHTML") => node.set_html(value),
            ("setAttr", _) => node.set_attr(property, value),
            ("removeAttr", _) => node.remove_attr(property),
            _ => return Err(Error::Dom(format!("unsupported write: {property}"))),
        }
        Ok(())
    }
}

fn hierarchy_error() -> Error {
    Error::DomException {
        name: "HierarchyRequestError",
        message: "invalid child type, document structure or DOM cycle",
    }
}

fn not_found() -> Error {
    Error::DomException {
        name: "NotFoundError",
        message: "reference node is not a child of this parent",
    }
}

fn validate_insertion(
    parent: NodeRef<'_>,
    inserted: &[NodeRef<'_>],
    reference: Option<NodeRef<'_>>,
    removed: Option<NodeRef<'_>>,
) -> Result<()> {
    if !parent.is_document() {
        if inserted.iter().any(NodeRef::is_doctype) {
            return Err(hierarchy_error());
        }
        return Ok(());
    }
    let mut children: Vec<_> = parent
        .children_it(false)
        .filter(|node| {
            !inserted.iter().any(|child| child.id == node.id)
                && removed.is_none_or(|removed| removed.id != node.id)
        })
        .collect();
    let index = reference
        .and_then(|reference| children.iter().position(|node| node.id == reference.id))
        .unwrap_or(children.len());
    children.splice(index..index, inserted.iter().copied());
    let mut element = false;
    let mut doctype = false;
    for node in children {
        if node.is_text() || node.is_fragment() || node.is_document() {
            return Err(hierarchy_error());
        }
        if node.is_element() {
            if element {
                return Err(hierarchy_error());
            }
            element = true;
        }
        if node.is_doctype() {
            if element || doctype {
                return Err(hierarchy_error());
            }
            doctype = true;
        }
    }
    Ok(())
}

fn character_value(node: NodeRef<'_>) -> Value {
    node.query_or(Value::Null, |node| match &node.data {
        NodeData::Text { contents }
        | NodeData::Comment { contents }
        | NodeData::ProcessingInstruction { contents, .. } => json!(contents.to_string()),
        _ => Value::Null,
    })
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

fn valid_element_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first.is_ascii_alphabetic() {
        return !chars.any(|character| {
            matches!(
                character,
                '\t' | '\n' | '\r' | '\u{c}' | ' ' | '\0' | '/' | '>'
            )
        });
    }
    (matches!(first, ':' | '_') || first >= '\u{80}')
        && chars.all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '-' | '.' | ':' | '_')
                || character >= '\u{80}'
        })
}
