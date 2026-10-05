use super::{Dom, Handle};
use crate::{Error, Result};
use dom_query::{Attr, NodeData, NodeId};
use serde_json::{Value, json};
use std::collections::HashMap;

struct Record {
    attribute: Attr,
    owner: Option<NodeId>,
    document: NodeId,
}
#[derive(Default)]
pub(super) struct Arena {
    records: HashMap<usize, Record>,
    owners: HashMap<NodeId, Vec<usize>>,
}
fn same(a: &Attr, b: &Attr) -> bool {
    a.name.ns == b.name.ns && a.name.local == b.name.local
}
fn qualified(attribute: &Attr) -> String {
    attribute.name.prefix.as_ref().map_or_else(
        || attribute.name.local.to_string(),
        |prefix| format!("{prefix}:{}", attribute.name.local),
    )
}
impl Arena {
    fn allocate(
        &mut self,
        handles: &mut Vec<Handle>,
        attribute: Attr,
        owner: Option<NodeId>,
        document: NodeId,
    ) -> usize {
        let handle = handles.len();
        handles.push(Handle::Attribute);
        self.records.insert(
            handle,
            Record {
                attribute,
                owner,
                document,
            },
        );
        if let Some(owner) = owner {
            self.owners.entry(owner).or_default().push(handle);
        }
        handle
    }
    fn sync(&mut self, owner: NodeId, attributes: &[Attr], document: NodeId) {
        if let Some(handles) = self.owners.get_mut(&owner) {
            handles.retain(|handle| {
                let Some(record) = self.records.get_mut(handle) else {
                    return false;
                };
                if let Some(attribute) = attributes
                    .iter()
                    .find(|attribute| same(attribute, &record.attribute))
                {
                    record.attribute = attribute.clone();
                    record.document = document;
                    true
                } else {
                    record.owner = None;
                    false
                }
            });
        }
    }
    fn list(
        &mut self,
        handles: &mut Vec<Handle>,
        owner: NodeId,
        attributes: &[Attr],
        document: NodeId,
    ) -> Vec<usize> {
        self.sync(owner, attributes, document);
        attributes
            .iter()
            .map(|attribute| {
                let existing = self.owners.get(&owner).and_then(|handles| {
                    handles
                        .iter()
                        .find(|handle| {
                            self.records
                                .get(handle)
                                .is_some_and(|record| same(&record.attribute, attribute))
                        })
                        .copied()
                });
                existing.unwrap_or_else(|| {
                    self.allocate(handles, attribute.clone(), Some(owner), document)
                })
            })
            .collect()
    }
    fn record(&self, handle: usize) -> Result<&Record> {
        self.records
            .get(&handle)
            .ok_or_else(|| Error::Dom("invalid attribute handle".into()))
    }
    fn detach(&mut self, handle: usize) -> Result<()> {
        let record = self
            .records
            .get_mut(&handle)
            .ok_or_else(|| Error::Dom("invalid attribute handle".into()))?;
        if let Some(owner) = record.owner.take()
            && let Some(handles) = self.owners.get_mut(&owner)
        {
            handles.retain(|candidate| *candidate != handle);
        }
        Ok(())
    }
}
impl Dom {
    pub(super) fn sync_attributes(&mut self, owner: NodeId) {
        if !self.attribute_nodes.owners.contains_key(&owner) {
            return;
        }
        if let Some(node) = self.document.tree.get(&owner) {
            self.attribute_nodes
                .sync(owner, &node.attrs(), self.node_document(owner));
        }
    }
    pub(super) fn sync_attribute_owner(
        &mut self,
        operation: &str,
        handle: usize,
    ) -> Result<Option<NodeId>> {
        if !matches!(
            operation,
            "setAttr" | "removeAttr" | "setAttrNS" | "removeAttrNS" | "style"
        ) {
            return Ok(None);
        }
        let owner = self.node_id(handle)?;
        self.sync_attributes(owner);
        Ok(Some(owner))
    }
    pub(super) fn attribute_node_bridge(
        &mut self,
        handle: usize,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        match operation {
            "new" | "newNS" => self.create_attribute_node(handle, operation, value),
            "list" | "named" | "ns" => self.attribute_node_lookup(handle, operation, value),
            "attach" => self.attach_attribute_node(handle, value),
            "remove" => self.remove_attribute_node(handle, value),
            _ => Err(Error::Dom("unsupported attribute node operation".into())),
        }
    }
    fn create_attribute_node(
        &mut self,
        owner: usize,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        let document = self.document_id(owner)?;
        let html = self
            .documents
            .kinds
            .get(&document)
            .is_none_or(|kind| kind.html);
        self.charge_write(value.len())?;
        let template = self
            .document
            .root()
            .descendants_it()
            .find(dom_query::NodeRef::is_element)
            .ok_or_else(|| Error::Dom("missing document element".into()))?;
        let attribute = if operation == "newNS" {
            let (namespace, name): (String, String) = serde_json::from_str(value)?;
            crate::dom_attributes::create_namespaced(template, &namespace, &name, "")?
        } else {
            crate::dom_attributes::create_named(template, value, "", html)?
        };
        Ok(json!(self.attribute_nodes.allocate(
            &mut self.handles,
            attribute,
            None,
            document
        )))
    }
    fn attribute_node_lookup(
        &mut self,
        handle: usize,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        let node = self.node(handle)?;
        if !node.is_element() {
            return Err(Error::Dom("attribute owner must be an element".into()));
        }
        let owner = node.id;
        let attributes = node.attrs();
        let document = self.node_document(owner);
        let handles = self
            .attribute_nodes
            .list(&mut self.handles, owner, &attributes, document);
        if operation == "list" {
            return Ok(json!(handles));
        }
        let key = if operation == "ns" {
            let (namespace, local): (String, String) = serde_json::from_str(value)?;
            attributes.iter().position(|attribute| {
                attribute.name.ns.as_ref() == namespace && attribute.name.local.as_ref() == local
            })
        } else {
            let name = crate::dom_attributes::normalized_name(
                self.node(handle)?,
                value,
                self.html_document(owner),
            );
            attributes
                .iter()
                .position(|attribute| qualified(attribute) == name)
        };
        Ok(json!(key.and_then(|index| handles.get(index).copied())))
    }
    pub(super) fn attribute_node_call(
        &mut self,
        operation: &str,
        handle: usize,
        arg: &str,
        value: &str,
    ) -> Result<Value> {
        let owner = self.attribute_nodes.record(handle)?.owner;
        if let Some(owner) = owner {
            self.sync_attributes(owner);
        }
        let record = self.attribute_nodes.record(handle)?;
        match operation {
            "get" => Ok(match arg {
                "nodeType" => json!(2),
                "nodeName" | "name" => json!(qualified(&record.attribute)),
                "nodeValue" | "textContent" | "value" => json!(record.attribute.value.as_ref()),
                "localName" => json!(record.attribute.name.local.as_ref()),
                "namespaceURI" => json!(if record.attribute.name.ns.is_empty() {
                    None
                } else {
                    Some(record.attribute.name.ns.as_ref())
                }),
                "prefix" => json!(record.attribute.name.prefix.as_ref().map(AsRef::as_ref)),
                "ownerDocument" => self.owner_document_value(record.document),
                "specified" => json!(true),
                "isConnected" => json!(false),
                "ownerElement" => {
                    let owner = record.owner;
                    json!(owner.map(|owner| self.handle(owner)))
                }
                _ => return Err(Error::Dom("unsupported attribute node property".into())),
            }),
            "set" if matches!(arg, "nodeValue" | "textContent" | "value") => {
                self.set_attribute_node_value(handle, value)
            }
            "relativeNode" | "parentElement" | "remove" => Ok(Value::Null),
            "children" => Ok(json!([])),
            "contains" => Ok(json!(arg.parse::<usize>().ok() == Some(handle))),
            "append" | "insert" | "replace" => Err(super::hierarchy_error()),
            "removeChild" => Err(super::not_found()),
            "attributeNode" if arg == "clone" => {
                let attribute = record.attribute.clone();
                let document = record.document;
                self.charge_write(attribute.value.len())?;
                Ok(json!(self.attribute_nodes.allocate(
                    &mut self.handles,
                    attribute,
                    None,
                    document
                )))
            }
            _ => Err(Error::Dom("unsupported attribute node operation".into())),
        }
    }
    fn set_attribute_node_value(&mut self, handle: usize, value: &str) -> Result<Value> {
        self.charge_write(value.len())?;
        let record = self.attribute_nodes.record(handle)?;
        let owner = record.owner;
        let name = record.attribute.name.clone();
        if let Some(owner) = owner {
            let owner_handle = self.handle(owner);
            let local = name.local.as_ref();
            if name.ns.is_empty() {
                self.invalidate_sheet("setAttr", owner_handle, local, value)?;
            }
            self.node(owner_handle)?.update(|node| {
                if let NodeData::Element(element) = &mut node.data
                    && let Some(attribute) = element.attrs.iter_mut().find(|attribute| {
                        attribute.name.ns == name.ns && attribute.name.local == name.local
                    })
                {
                    attribute.value = value.into();
                }
            });
            self.invalidate_attribute_node(owner_handle, name.ns.as_ref(), local)?;
            self.sync_attributes(owner);
        } else if let Some(record) = self.attribute_nodes.records.get_mut(&handle) {
            record.attribute.value = value.into();
        }
        Ok(Value::Null)
    }
    fn invalidate_attribute_node(
        &mut self,
        owner: usize,
        namespace: &str,
        local: &str,
    ) -> Result<()> {
        self.layout_version = self.layout_version.saturating_add(1);
        self.computed_styles.clear();
        if namespace.is_empty() && local == "style" {
            let id = self.node_id(owner)?;
            if let Some(previous) = self.styles.remove(&id) {
                self.style_bytes = self.style_bytes.saturating_sub(previous.bytes());
            }
        }
        Ok(())
    }
    fn attach_attribute_node(&mut self, owner_handle: usize, value: &str) -> Result<Value> {
        let incoming = value
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        let owner = self.node_id(owner_handle)?;
        let record = self.attribute_nodes.record(incoming)?;
        if record.owner.is_some_and(|current| current != owner) {
            return Err(Error::DomException {
                name: "InUseAttributeError",
                message: "attribute is already attached to another element",
            });
        }
        if record.owner == Some(owner) {
            return Ok(json!(incoming));
        }
        let attribute = record.attribute.clone();
        self.charge_write(attribute.value.len())?;
        let attributes = self.node(owner_handle)?.attrs();
        let document = self.node_document(owner);
        let handles = self
            .attribute_nodes
            .list(&mut self.handles, owner, &attributes, document);
        let position = attributes
            .iter()
            .position(|current| same(current, &attribute));
        let previous = position.and_then(|position| handles.get(position).copied());
        if let Some(previous) = previous {
            self.attribute_nodes.detach(previous)?;
        }
        if attribute.name.ns.is_empty() {
            self.invalidate_sheet(
                "setAttr",
                owner_handle,
                attribute.name.local.as_ref(),
                attribute.value.as_ref(),
            )?;
        }
        self.node(owner_handle)?.update(|node| {
            if let NodeData::Element(element) = &mut node.data {
                if let Some(current) = position.and_then(|position| element.attrs.get_mut(position))
                {
                    *current = attribute.clone();
                } else {
                    element.attrs.push(attribute.clone());
                }
            }
        });
        self.attribute_nodes
            .records
            .get_mut(&incoming)
            .ok_or_else(|| Error::Dom("invalid attribute handle".into()))?
            .owner = Some(owner);
        self.attribute_nodes
            .owners
            .entry(owner)
            .or_default()
            .push(incoming);
        self.invalidate_attribute_node(
            owner_handle,
            attribute.name.ns.as_ref(),
            attribute.name.local.as_ref(),
        )?;
        Ok(json!(previous))
    }
    fn remove_attribute_node(&mut self, owner_handle: usize, value: &str) -> Result<Value> {
        let handle = value
            .parse::<usize>()
            .map_err(|error| Error::Dom(error.to_string()))?;
        let owner = self.node_id(owner_handle)?;
        self.sync_attributes(owner);
        let record = self.attribute_nodes.record(handle)?;
        if record.owner != Some(owner) {
            return Err(super::not_found());
        }
        let attribute = record.attribute.clone();
        self.charge_write(0)?;
        if attribute.name.ns.is_empty() {
            self.invalidate_sheet(
                "removeAttr",
                owner_handle,
                attribute.name.local.as_ref(),
                "",
            )?;
        }
        crate::dom_attributes::remove_namespaced(
            self.node(owner_handle)?,
            attribute.name.ns.as_ref(),
            attribute.name.local.as_ref(),
        );
        self.attribute_nodes.detach(handle)?;
        self.invalidate_attribute_node(
            owner_handle,
            attribute.name.ns.as_ref(),
            attribute.name.local.as_ref(),
        )?;
        Ok(json!(handle))
    }
}
