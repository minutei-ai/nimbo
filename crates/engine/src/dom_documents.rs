use super::Dom;
use crate::{Error, Result};
use dom_query::{Document, NodeData, NodeId};
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
impl Arena {
    pub(super) fn owner(&self, document: &Document, id: NodeId) -> NodeId {
        if self.kinds.is_empty() {
            return document.root().id;
        }
        let owners = self.owners.borrow();
        owners
            .get(&id)
            .copied()
            .or_else(|| {
                document.tree.get(&id).and_then(|node| {
                    node.ancestors_it(None)
                        .find_map(|ancestor| owners.get(&ancestor.id).copied())
                })
            })
            .unwrap_or(document.root().id)
    }
}

impl Dom {
    pub(crate) fn navigation_type(&mut self, content_type: &'static str) {
        if content_type == "text/html" {
            return;
        }
        self.documents.kinds.insert(
            self.document.root().id,
            Kind {
                html: true,
                content_type,
            },
        );
    }

    pub(super) fn create_fragment(&mut self, owner: usize) -> Result<Value> {
        self.allocate_node()?;
        let id = self.document.tree.create_node(NodeData::Fragment);
        self.own_node(owner, id)?;
        Ok(json!(self.handle(id)))
    }

    pub(super) fn html_document(&self, id: NodeId) -> bool {
        let root = self.documents.owner(&self.document, id);
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
        if self.documents.owner(&self.document, id) == document {
            return Ok(());
        }
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid adopted node".into()))?;
        let mut images = self.images.borrow_mut();
        images.adopted(node);
        let mut owners = self.documents.owners.borrow_mut();
        owners.insert(id, document);
        for descendant in node.descendants_it() {
            images.adopted(descendant);
            owners.insert(descendant.id, document);
        }
        for (root_id, shadow) in &self.shadow.roots {
            if self.shadow_contains(id, shadow.host)? {
                owners.insert(*root_id, document);
                let root = self
                    .document
                    .tree
                    .get(root_id)
                    .ok_or_else(|| Error::Dom("invalid adopted shadow root".into()))?;
                images.adopted(root);
                for descendant in root.descendants_it() {
                    images.adopted(descendant);
                    owners.insert(descendant.id, document);
                }
            }
        }
        Ok(())
    }
    pub(super) fn new_html_document(&mut self, owner: usize, request: &str) -> Result<Value> {
        self.document_id(owner)?;
        let title: Option<String> = serde_json::from_str(request)?;
        let (nodes, bytes) = title
            .as_ref()
            .map_or((5, 16), |text| (7, 21_usize.saturating_add(text.len())));
        self.charge_write(bytes)?;
        for _ in 0..nodes {
            self.control_view().charge()?;
            self.allocate_node()?;
        }
        let tree = &self.document.tree;
        let id = tree.create_node(NodeData::Document);
        let root = tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid HTML document root".into()))?;
        let doctype = tree.create_node(NodeData::Doctype {
            name: "html".into(),
            public_id: "".into(),
            system_id: "".into(),
        });
        root.append_child(&doctype);
        let html = tree.new_element("html");
        let head = tree.new_element("head");
        let body = tree.new_element("body");
        root.append_child(&html.id);
        html.append_child(&head.id);
        html.append_child(&body.id);
        let mut ids = vec![id, doctype, html.id, head.id, body.id];
        if let Some(title) = title {
            let element = tree.new_element("title");
            let text = tree.new_text(title.as_str());
            head.append_child(&element.id);
            element.append_child(&text.id);
            ids.extend([element.id, text.id]);
        }
        self.documents.kinds.insert(
            id,
            Kind {
                html: true,
                content_type: "text/html",
            },
        );
        for child in ids {
            self.documents.owners.borrow_mut().insert(child, id);
        }
        Ok(json!(self.handle(id)))
    }

    pub(super) fn new_document(&mut self, owner: usize, request: &str) -> Result<Value> {
        self.document_id(owner)?;
        let (namespace, name): (String, String) = serde_json::from_str(request)?;
        self.charge_write(request.len())?;
        self.allocate_node()?;
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
        let document = self.documents.owner(&self.document, id);
        json!(self.ids.get(&document).copied().unwrap_or(0))
    }
}
