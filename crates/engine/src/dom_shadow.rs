use super::Dom;
use crate::dom_attributes::NativeAttributes;
use crate::{Error, Result};
use dom_query::{NodeData, NodeId};
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Clone, Copy)]
pub(super) struct Root {
    pub(super) host: NodeId,
    pub(super) closed: bool,
}

#[derive(Default)]
pub(super) struct Arena {
    pub(super) roots: HashMap<NodeId, Root>,
    pub(super) hosts: HashMap<NodeId, NodeId>,
    assigned: HashMap<NodeId, Vec<NodeId>>,
    slot_for: HashMap<NodeId, NodeId>,
    changes: Vec<NodeId>,
}

impl Dom {
    pub(super) fn fallback_slot_targets(
        &self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Vec<NodeId> {
        if self.shadow.roots.is_empty() {
            return Vec::new();
        }
        let mut candidates = Vec::new();
        if (matches!(operation, "append" | "insert" | "replace" | "removeChild")
            || (operation == "set" && matches!(arg, "innerHTML" | "textContent")))
            && let Ok(parent) = self.node(handle)
            && (operation != "set" || !value.is_empty() || parent.first_child().is_some())
        {
            candidates.push(parent.id);
        }
        let source = if matches!(operation, "append" | "insert" | "replace" | "removeChild") {
            value.parse::<usize>().ok()
        } else if operation == "remove" {
            Some(handle)
        } else {
            None
        };
        if let Some(source) = source
            && let Ok(child) = self.node(source)
            && let Some(parent) = child.parent()
        {
            candidates.push(parent.id);
        }
        candidates.retain(|id| self.shadow.assigned.get(id).is_some_and(Vec::is_empty));
        candidates
    }

    pub(super) fn signal_fallback_slots(&mut self, slots: &[NodeId]) {
        for id in slots {
            if !self.shadow.changes.contains(id) {
                self.shadow.changes.push(*id);
            }
        }
    }
    pub(super) fn tree_root(&self, mut id: NodeId, composed: bool) -> Result<NodeId> {
        loop {
            let node = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid tree root node".into()))?;
            id = node
                .ancestors_it(None)
                .last()
                .map_or(id, |parent| parent.id);
            if composed && let Some(root) = self.shadow.roots.get(&id) {
                id = root.host;
            } else {
                return Ok(id);
            }
        }
    }

    pub(super) fn shadow_contains(&self, ancestor: NodeId, mut descendant: NodeId) -> Result<bool> {
        loop {
            let node = self
                .document
                .tree
                .get(&descendant)
                .ok_or_else(|| Error::Dom("invalid shadow descendant".into()))?;
            if ancestor == descendant || node.ancestors_it(None).any(|node| node.id == ancestor) {
                return Ok(true);
            }
            if self.shadow.roots.is_empty() {
                return Ok(false);
            }
            let root = self.tree_root(descendant, false)?;
            if let Some(shadow) = self.shadow.roots.get(&root) {
                descendant = shadow.host;
            } else {
                return Ok(false);
            }
        }
    }

    pub(super) fn shadow_call(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
    ) -> Result<Value> {
        let id = self.node_id(handle)?;
        match operation {
            "assignedSlot" => {
                let slot = self.shadow.slot_for.get(&id).copied().filter(|slot| {
                    arg != "open"
                        || self.tree_root(*slot, false).is_ok_and(|root| {
                            self.shadow
                                .roots
                                .get(&root)
                                .is_some_and(|root| !root.closed)
                        })
                });
                Ok(json!(slot.map(|id| self.handle(id))))
            }
            "slotNodes" => {
                let ids = self.slot_nodes(id, arg == "flatten")?;
                Ok(json!(
                    ids.into_iter()
                        .map(|id| self.handle(id))
                        .collect::<Vec<_>>()
                ))
            }
            "slotChanges" => {
                let changes = std::mem::take(&mut self.shadow.changes);
                Ok(json!(
                    changes
                        .into_iter()
                        .map(|id| self.handle(id))
                        .collect::<Vec<_>>()
                ))
            }
            "elementById" => {
                if arg.is_empty() {
                    return Ok(Value::Null);
                }
                let root = self.node(handle)?;
                let found = root
                    .descendants_it()
                    .find(|node| {
                        node.is_element() && node.null_attribute("id").as_deref() == Some(arg)
                    })
                    .map(|node| node.id);
                Ok(json!(found.map(|id| self.handle(id))))
            }
            "attachShadow" => self.attach_shadow(id, arg),
            "shadowRoot" => {
                let root =
                    self.shadow.hosts.get(&id).copied().filter(|root| {
                        self.shadow.roots.get(root).is_some_and(|root| !root.closed)
                    });
                Ok(json!(root.map(|root| self.handle(root))))
            }
            "shadowInfo" => {
                let root = self.shadow.roots.get(&id).copied();
                Ok(root.map_or(Value::Null, |root| {
                    json!([
                        self.handle(root.host),
                        if root.closed { "closed" } else { "open" }
                    ])
                }))
            }
            "rootNode" => {
                let root = self.tree_root(id, arg == "composed")?;
                Ok(json!(self.handle(root)))
            }
            "shadowContains" => {
                let other = arg
                    .parse::<usize>()
                    .map_err(|error| Error::Dom(error.to_string()))?;
                Ok(json!(self.shadow_contains(id, self.node_id(other)?)?))
            }
            _ => Err(Error::Dom("invalid shadow operation".into())),
        }
    }

    fn attach_shadow(&mut self, host: NodeId, mode: &str) -> Result<Value> {
        if !matches!(mode, "open" | "closed") {
            return Err(Error::Dom("invalid shadow mode".into()));
        }
        let node = self
            .document
            .tree
            .get(&host)
            .ok_or_else(|| Error::Dom("invalid shadow host".into()))?;
        if !node.query_or(false, |node| {
            matches!(&node.data, NodeData::Element(element)
            if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml" && valid_host(&element.name.local))
        }) {
            return Err(Error::DomException {
                name: "NotSupportedError",
                message: "shadow host must be an HTML element",
            });
        }
        if self.shadow.hosts.contains_key(&host) {
            return Err(Error::DomException {
                name: "NotSupportedError",
                message: "shadow root already attached",
            });
        }
        if self.shadow.roots.len() >= 128 {
            return Err(Error::Limit("shadow root count"));
        }
        self.charge_write(1)?;
        self.allocate_node()?;
        let document = self.documents.owner(&self.document, host);
        let root = self.document.tree.create_node(NodeData::Fragment);
        if document != self.document.root().id {
            self.documents.owners.borrow_mut().insert(root, document);
        }
        self.shadow.hosts.insert(host, root);
        self.shadow.roots.insert(
            root,
            Root {
                host,
                closed: mode == "closed",
            },
        );
        Ok(json!(self.handle(root)))
    }

    pub(super) fn shadow_descendants(&mut self, root: NodeId) -> Result<Vec<NodeId>> {
        let mut pending = vec![root];
        let mut result = Vec::new();
        while let Some(id) = pending.pop() {
            if self.operations >= self.limits.max_dom_operations {
                return Err(Error::Limit("DOM operations"));
            }
            self.operations = self.operations.saturating_add(1);
            result.push(id);
            let node = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid shadow traversal node".into()))?;
            pending.extend(node.children_it(true).map(|child| child.id));
            if let Some(shadow) = self.shadow.hosts.get(&id) {
                pending.push(*shadow);
            }
            if pending.len()
                > self
                    .limits
                    .max_dom_operations
                    .saturating_sub(self.operations)
            {
                return Err(Error::Limit("DOM operations"));
            }
        }
        Ok(result)
    }

    pub(super) fn shadow_style_guard(&self, id: NodeId) -> Result<()> {
        if self.shadow.roots.is_empty() {
            return Ok(());
        }
        let root = self.tree_root(id, false)?;
        if self.shadow.roots.contains_key(&root) || self.shadow.hosts.contains_key(&id) {
            return Err(Error::Unsupported("shadow style and geometry".into()));
        }
        Ok(())
    }

    pub(super) fn refresh_slots(&mut self) -> Result<()> {
        if self.shadow.roots.is_empty() {
            return Ok(());
        }
        let mut assigned = HashMap::<NodeId, Vec<NodeId>>::new();
        let mut slot_for = HashMap::new();
        let mut work = crate::layout::Work::new(
            &mut self.operations,
            self.limits.max_dom_operations,
            self.limits.max_layout_nodes,
        );
        for (root_id, root) in &self.shadow.roots {
            let root_node = self
                .document
                .tree
                .get(root_id)
                .ok_or_else(|| Error::Dom("invalid slot root".into()))?;
            let mut names = HashMap::new();
            for node in root_node.descendants_it() {
                work.charge()?;
                if is_slot(node) {
                    names
                        .entry(node.null_attribute("name").unwrap_or_default())
                        .or_insert(node.id);
                    assigned.insert(node.id, Vec::new());
                }
            }
            let host = self
                .document
                .tree
                .get(&root.host)
                .ok_or_else(|| Error::Dom("invalid slot host".into()))?;
            for child in host.children_it(false) {
                work.charge()?;
                if child.is_element() || child.is_text() {
                    let name = child.null_attribute("slot").unwrap_or_default();
                    if let Some(slot) = names.get(&name)
                        && let Some(nodes) = assigned.get_mut(slot)
                    {
                        nodes.push(child.id);
                        slot_for.insert(child.id, *slot);
                    }
                }
            }
        }
        for slot in self.shadow.assigned.keys().chain(assigned.keys()) {
            let before = self
                .shadow
                .assigned
                .get(slot)
                .map_or(&[][..], Vec::as_slice);
            let after = assigned.get(slot).map_or(&[][..], Vec::as_slice);
            if before != after && !self.shadow.changes.contains(slot) {
                self.shadow.changes.push(*slot);
            }
        }
        self.shadow.assigned = assigned;
        self.shadow.slot_for = slot_for;
        Ok(())
    }

    fn slot_nodes(&mut self, slot: NodeId, flatten: bool) -> Result<Vec<NodeId>> {
        let node = self
            .document
            .tree
            .get(&slot)
            .ok_or_else(|| Error::Dom("invalid slot".into()))?;
        if !is_slot(node) {
            return Err(Error::Dom("slot owner must be HTMLSlotElement".into()));
        }
        if !flatten {
            return Ok(self.shadow.assigned.get(&slot).cloned().unwrap_or_default());
        }
        let mut pending = vec![slot];
        let mut result = Vec::new();
        while let Some(id) = pending.pop() {
            if self.operations >= self.limits.max_dom_operations {
                return Err(Error::Limit("DOM operations"));
            }
            self.operations = self.operations.saturating_add(1);
            let node = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid flattened slot".into()))?;
            if is_slot(node) && self.shadow.roots.contains_key(&self.tree_root(id, false)?) {
                if let Some(assigned) = self
                    .shadow
                    .assigned
                    .get(&id)
                    .filter(|nodes| !nodes.is_empty())
                {
                    pending.extend(assigned.iter().rev().copied());
                } else {
                    pending.extend(
                        node.children_it(true)
                            .filter(|node| node.is_element() || node.is_text())
                            .map(|node| node.id),
                    );
                }
            } else if id != slot {
                result.push(id);
            }
            if pending.len()
                > self
                    .limits
                    .max_dom_operations
                    .saturating_sub(self.operations)
            {
                return Err(Error::Limit("DOM operations"));
            }
        }
        Ok(result)
    }
}

fn is_slot(node: dom_query::NodeRef<'_>) -> bool {
    node.has_name("slot")
        && node
            .qual_name_ref()
            .is_some_and(|name| name.ns.as_ref() == "http://www.w3.org/1999/xhtml")
}

fn valid_host(name: &str) -> bool {
    if matches!(
        name,
        "article"
            | "aside"
            | "blockquote"
            | "body"
            | "div"
            | "footer"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "main"
            | "nav"
            | "p"
            | "section"
            | "span"
    ) {
        return true;
    }
    name.contains('-') && name.chars().next().is_some_and(|ch| ch.is_ascii_lowercase())
        && name.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(u32::from(ch), 0x2d | 0x2e | 0x5f | 0xb7 | 0xc0..=0xd6 | 0xd8..=0xf6 | 0xf8..=0x37d | 0x37f..=0x1fff | 0x200c..=0x200d | 0x203f..=0x2040 | 0x2070..=0x218f | 0x2c00..=0x2fef | 0x3001..=0xd7ff | 0xf900..=0xfdcf | 0xfdf0..=0xfffd | 0x10000..=0xeffff))
        && !matches!(name, "annotation-xml" | "color-profile" | "font-face" | "font-face-src" | "font-face-uri" | "font-face-format" | "font-face-name" | "missing-glyph")
}
