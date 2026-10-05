use super::Dom;
use crate::{Error, Result};
use dom_query::{NodeData, NodeId};
use serde_json::{Value, json};
use std::{cell::RefCell, collections::HashMap};

#[derive(Clone, Copy)]
pub(super) struct Kind {
    pub(super) html: bool,
    pub(super) content_type: &'static str,
}
#[derive(Default)]
pub(super) struct Arena {
    pub(super) kinds: HashMap<NodeId, Kind>,
    pub(super) owners: RefCell<HashMap<NodeId, NodeId>>,
}
impl Dom {
    pub(super) fn node_document(&self, id: NodeId) -> NodeId {
        if self.documents.kinds.is_empty() {
            return self.document.root().id;
        }
        let owners = self.documents.owners.borrow();
        owners
            .get(&id)
            .copied()
            .or_else(|| {
                self.document.tree.get(&id).and_then(|node| {
                    node.ancestors_it(None)
                        .find_map(|ancestor| owners.get(&ancestor.id).copied())
                })
            })
            .unwrap_or(self.document.root().id)
    }
    pub(super) fn html_document(&self, id: NodeId) -> bool {
        let root = self.node_document(id);
        self.documents.kinds.get(&root).is_none_or(|kind| kind.html)
    }
    pub(super) fn document_id(&self, handle: usize) -> Result<NodeId> {
        let node = self.node(handle)?;
        if !node.is_document() {
            return Err(Error::Dom("factory requires a document".into()));
        }
        Ok(node.id)
    }
    pub(super) fn own_node(&self, owner: usize, id: NodeId) -> Result<()> {
        if owner == 0 {
            return Ok(());
        }
        let document = self.document_id(owner)?;
        self.documents.owners.borrow_mut().insert(id, document);
        Ok(())
    }
    pub(super) fn adopt_tree(&self, id: NodeId, document: NodeId) -> Result<()> {
        if self.node_document(id) == document {
            return Ok(());
        }
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid adopted node".into()))?;
        let mut owners = self.documents.owners.borrow_mut();
        owners.insert(id, document);
        for descendant in node.descendants_it() {
            owners.insert(descendant.id, document);
        }
        Ok(())
    }
    pub(super) fn new_document(&mut self, owner: usize, request: &str) -> Result<Value> {
        self.document_id(owner)?;
        let (namespace, name): (String, String) = serde_json::from_str(request)?;
        self.charge_write(request.len())?;
        let id = self.document.tree.create_node(NodeData::Document);
        let content_type = match namespace.as_str() {
            "http://www.w3.org/1999/xhtml" => "application/xhtml+xml",
            "http://www.w3.org/2000/svg" => "image/svg+xml",
            _ => "application/xml",
        };
        self.documents.kinds.insert(
            id,
            Kind {
                html: false,
                content_type,
            },
        );
        self.documents.owners.borrow_mut().insert(id, id);
        let handle = self.handle(id);
        if !name.is_empty() {
            let element = self.create_ns(handle, &name, &namespace)?;
            let child = element
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| Error::Dom("invalid document element".into()))?;
            self.insert("append", handle, "", &child.to_string())?;
        }
        Ok(json!(handle))
    }
    pub(super) fn owner_document_value(&self, id: NodeId) -> Value {
        let document = self.node_document(id);
        json!(self.ids.get(&document).copied().unwrap_or(0))
    }
}
