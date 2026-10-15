use std::collections::VecDeque;

use dom_query::{NodeData, NodeId};
use serde_json::{Value, json};

use super::{Dom, Handle, documents::Kind};
use crate::{Error, Result};

impl Dom {
    pub(super) fn clone_node(&mut self, handle: usize, deep: &str) -> Result<Value> {
        let deep = serde_json::from_str::<bool>(deep)?;
        if matches!(self.handles.get(handle), Some(Handle::Attribute)) {
            return self.clone_attribute(handle);
        }
        let source = self.node_id(handle)?;
        if self.shadow.roots.contains_key(&source) {
            return Err(Error::DomException {
                name: "NotSupportedError",
                message: "Shadow roots cannot be cloned",
            });
        }
        let mut document = self.node_document(source);
        let mut pending = VecDeque::new();
        let root = self.clone_shallow(source, document, deep, &mut pending)?;
        if self.node(handle)?.is_document() {
            document = root;
        }
        while let Some((source, target)) = pending.pop_front() {
            let children = self
                .document
                .tree
                .get(&source)
                .ok_or_else(|| Error::Dom("invalid clone source".into()))?
                .children_it(false)
                .map(|node| node.id)
                .collect::<Vec<_>>();
            for child in children {
                let copy = self.clone_shallow(child, document, deep, &mut pending)?;
                self.document
                    .tree
                    .get(&target)
                    .ok_or_else(|| Error::Dom("invalid clone target".into()))?
                    .append_child(&copy);
            }
        }
        Ok(json!(self.handle(root)))
    }

    fn clone_shallow(
        &mut self,
        source: NodeId,
        document: NodeId,
        deep: bool,
        pending: &mut VecDeque<(NodeId, NodeId)>,
    ) -> Result<NodeId> {
        self.control_view().charge()?;
        let node = self
            .document
            .tree
            .get(&source)
            .ok_or_else(|| Error::Dom("invalid clone source".into()))?;
        let bytes = node.query_or(0, |node| match &node.data {
            NodeData::Element(element) => element.attrs.iter().fold(
                element
                    .name
                    .ns
                    .len()
                    .saturating_add(element.name.local.len()),
                |bytes, attr| {
                    bytes
                        .saturating_add(attr.name.ns.len())
                        .saturating_add(attr.name.local.len())
                        .saturating_add(attr.value.len())
                },
            ),
            NodeData::Text { contents } | NodeData::Comment { contents } => contents.len(),
            NodeData::ProcessingInstruction { target, contents } => {
                target.len().saturating_add(contents.len())
            }
            NodeData::Doctype {
                name,
                public_id,
                system_id,
            } => name
                .len()
                .saturating_add(public_id.len())
                .saturating_add(system_id.len()),
            NodeData::Document | NodeData::Fragment => 0,
        });
        self.charge_write(bytes)?;
        let mut data = self
            .document
            .tree
            .get(&source)
            .and_then(|node| node.query_or(None, |node| Some(node.data.clone())))
            .ok_or_else(|| Error::Dom("invalid clone data".into()))?;
        let template = if let NodeData::Element(element) = &mut data {
            element.template_contents.take()
        } else {
            None
        };
        let is_document = matches!(data, NodeData::Document);
        self.allocate_node()?;
        let copy = self.document.tree.create_node(data);
        let document = if is_document {
            self.documents.kinds.insert(
                copy,
                self.documents.kinds.get(&source).copied().unwrap_or(Kind {
                    html: true,
                    content_type: "text/html",
                }),
            );
            copy
        } else {
            document
        };
        self.documents.owners.borrow_mut().insert(copy, document);
        self.clone_control_value(source, copy)?;
        self.checkedness.clone_state(source, copy);
        if deep {
            pending.push_back((source, copy));
        }
        if let Some(source_template) = template {
            self.allocate_node()?;
            let fragment = self.document.tree.create_node(NodeData::Fragment);
            self.documents
                .owners
                .borrow_mut()
                .insert(fragment, document);
            self.document
                .tree
                .get(&copy)
                .ok_or_else(|| Error::Dom("invalid cloned template".into()))?
                .update(|node| {
                    if let NodeData::Element(element) = &mut node.data {
                        element.template_contents = Some(fragment);
                    }
                });
            if deep {
                pending.push_back((source_template, fragment));
            }
        }
        Ok(copy)
    }
}
