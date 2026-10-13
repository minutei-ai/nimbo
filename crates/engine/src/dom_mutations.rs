use super::{Dom, Handle};
use crate::{Error, Result};
use dom_query::NodeId;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    rc::Rc,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Attributes,
    CharacterData,
    Children,
}

#[derive(Clone)]
pub(super) struct Record {
    pub(super) kind: Kind,
    pub(super) target: NodeId,
    pub(super) name: Option<String>,
    pub(super) namespace: Option<String>,
    pub(super) old: Option<Rc<str>>,
    pub(super) added: Vec<NodeId>,
    pub(super) removed: Vec<NodeId>,
    pub(super) previous: Option<NodeId>,
    pub(super) next: Option<NodeId>,
}
impl Record {
    pub(super) fn attribute(
        target: NodeId,
        name: String,
        namespace: Option<String>,
        old: Option<String>,
    ) -> Self {
        Self {
            kind: Kind::Attributes,
            target,
            name: Some(name),
            namespace,
            old: old.map(Rc::from),
            added: Vec::new(),
            removed: Vec::new(),
            previous: None,
            next: None,
        }
    }
    pub(super) fn character(target: NodeId, old: String) -> Self {
        Self {
            kind: Kind::CharacterData,
            target,
            name: None,
            namespace: None,
            old: Some(Rc::from(old)),
            added: Vec::new(),
            removed: Vec::new(),
            previous: None,
            next: None,
        }
    }
    pub(super) fn children(
        target: NodeId,
        added: Vec<NodeId>,
        removed: Vec<NodeId>,
        previous: Option<NodeId>,
        next: Option<NodeId>,
    ) -> Self {
        Self {
            kind: Kind::Children,
            target,
            name: None,
            namespace: None,
            old: None,
            added,
            removed,
            previous,
            next,
        }
    }
    fn bytes(&self) -> usize {
        64_usize
            .saturating_add(self.old.as_ref().map_or(0, |value| value.len()))
            .saturating_add(self.name.as_ref().map_or(0, String::len))
            .saturating_add(self.namespace.as_ref().map_or(0, String::len))
            .saturating_add(
                self.added
                    .len()
                    .saturating_add(self.removed.len())
                    .saturating_mul(8),
            )
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "Web IDL MutationObserverInit consists of independent flags"
)]
struct Options {
    child_list: bool,
    attributes: bool,
    character_data: bool,
    subtree: bool,
    attribute_old_value: bool,
    character_data_old_value: bool,
    attribute_filter: Option<Vec<String>>,
}
impl Options {
    fn accepts(&self, record: &Record) -> bool {
        match record.kind {
            Kind::Attributes => {
                self.attributes
                    && self.attribute_filter.as_ref().is_none_or(|names| {
                        record.namespace.is_none()
                            && record
                                .name
                                .as_ref()
                                .is_some_and(|name| names.contains(name))
                    })
            }
            Kind::CharacterData => self.character_data,
            Kind::Children => self.child_list,
        }
    }
    fn old(&self, kind: Kind) -> bool {
        match kind {
            Kind::Attributes => self.attribute_old_value,
            Kind::CharacterData => self.character_data_old_value,
            Kind::Children => false,
        }
    }
}
#[derive(Clone)]
struct Registration {
    observer: usize,
    target: Option<NodeId>,
    handle: usize,
    options: Options,
    source: Option<(usize, usize)>,
}
#[derive(Default)]
struct Queue {
    records: Vec<Record>,
    pending: bool,
}
#[derive(Default)]
pub(super) struct Arena {
    registrations: Vec<Registration>,
    observers: BTreeMap<usize, Queue>,
    records: usize,
    bytes: usize,
    pub(super) work: usize,
}
impl Arena {
    pub(super) fn active(&self) -> bool {
        !self.registrations.is_empty()
    }
    fn drain(&mut self, observer: usize, notify: bool) -> Result<Vec<Record>> {
        let queue = self
            .observers
            .get_mut(&observer)
            .ok_or_else(|| Error::Dom("invalid mutation observer".into()))?;
        let records = std::mem::take(&mut queue.records);
        for record in &records {
            self.bytes = self.bytes.saturating_sub(record.bytes());
        }
        self.records = self.records.saturating_sub(records.len());
        if notify {
            queue.pending = false;
            self.registrations
                .retain(|entry| !(entry.observer == observer && entry.source.is_some()));
        }
        Ok(records)
    }
}

impl Dom {
    pub(super) fn mutation_inserting(
        &self,
        parent: NodeId,
        child: NodeId,
        inserted: &[NodeId],
        replaced: Option<NodeId>,
        reference: Option<NodeId>,
    ) -> Result<()> {
        if !self.mutations.borrow().active() {
            return Ok(());
        }
        let child_node = self
            .document
            .tree
            .get(&child)
            .ok_or_else(|| Error::Dom("invalid mutation child".into()))?;
        let fragment = child_node.is_fragment();
        for id in inserted {
            self.mutation_removing(*id, fragment)?;
        }
        if fragment && !inserted.is_empty() {
            self.queue_mutation(&Record::children(
                child,
                Vec::new(),
                inserted.to_vec(),
                None,
                None,
            ))?;
        }
        let removed = replaced.filter(|id| *id != child);
        if let Some(removed) = removed {
            self.mutation_removing(removed, true)?;
        }
        let parent_node = self
            .document
            .tree
            .get(&parent)
            .ok_or_else(|| Error::Dom("invalid mutation insertion parent".into()))?;
        let mut previous = if let Some(replaced) = replaced {
            self.document
                .tree
                .get(&replaced)
                .and_then(|node| node.prev_sibling())
                .map(|node| node.id)
        } else if let Some(reference) = reference {
            self.document
                .tree
                .get(&reference)
                .and_then(|node| node.prev_sibling())
                .map(|node| node.id)
        } else {
            parent_node.last_child().map(|node| node.id)
        };
        while let Some(id) = previous.filter(|id| inserted.contains(id) || Some(*id) == removed) {
            previous = self
                .document
                .tree
                .get(&id)
                .and_then(|node| node.prev_sibling())
                .map(|node| node.id);
        }
        let mut next = reference;
        while let Some(id) = next.filter(|id| inserted.contains(id)) {
            next = self
                .document
                .tree
                .get(&id)
                .and_then(|node| node.next_sibling())
                .map(|node| node.id);
        }
        if !inserted.is_empty() || removed.is_some() {
            self.queue_mutation(&Record::children(
                parent,
                inserted.to_vec(),
                removed.into_iter().collect(),
                previous,
                next,
            ))?;
        }
        Ok(())
    }
    pub(super) fn capture_attribute_write(
        &self,
        operation: &str,
        handle: usize,
        name: &str,
    ) -> Result<Option<Record>> {
        if !self.mutations.borrow().active() || !matches!(operation, "setAttr" | "removeAttr") {
            return Ok(None);
        }
        let node = self.node(handle)?;
        let info = crate::dom_attributes::named_info(node, name, self.html_document(node.id));
        if operation == "removeAttr" && info.is_none() {
            return Ok(None);
        }
        let (name, namespace, old) = info.map_or_else(
            || {
                (
                    crate::dom_attributes::normalized_name(node, name, self.html_document(node.id)),
                    None,
                    None,
                )
            },
            |(name, namespace, value)| (name, namespace, Some(value)),
        );
        Ok(Some(Record::attribute(node.id, name, namespace, old)))
    }
    pub(super) fn capture_attribute_ns(
        &self,
        handle: usize,
        namespace: &str,
        name: &str,
        remove: bool,
    ) -> Result<Option<Record>> {
        if !self.mutations.borrow().active() {
            return Ok(None);
        }
        let node = self.node(handle)?;
        let name = if remove {
            name
        } else {
            name.split_once(':').map_or(name, |(_, local)| local)
        };
        let old = crate::dom_attributes::namespaced(node, namespace, name);
        if remove && old.is_none() {
            return Ok(None);
        }
        Ok(Some(Record::attribute(
            node.id,
            name.to_owned(),
            if namespace.is_empty() {
                None
            } else {
                Some(namespace.to_owned())
            },
            old,
        )))
    }
    pub(super) fn mutation_removing(&self, id: NodeId, suppress: bool) -> Result<()> {
        if !self.mutations.borrow().active() {
            return Ok(());
        }
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid removed mutation node".into()))?;
        if let Some(parent) = node.parent() {
            self.mutation_detaching(id, parent.id)?;
            if !suppress {
                self.queue_mutation(&Record::children(
                    parent.id,
                    Vec::new(),
                    vec![id],
                    node.prev_sibling().map(|node| node.id),
                    node.next_sibling().map(|node| node.id),
                ))?;
            }
        }
        Ok(())
    }
    pub(super) fn mutation_replacing_children(&self, id: NodeId) -> Result<Option<Vec<NodeId>>> {
        if !self.mutations.borrow().active() {
            return Ok(None);
        }
        let node = self
            .document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid mutation parent".into()))?;
        let removed: Vec<_> = node.children_it(false).map(|node| node.id).collect();
        for child in &removed {
            self.mutation_removing(*child, true)?;
        }
        Ok(Some(removed))
    }
    pub(super) fn mutation_replaced_children(
        &self,
        id: NodeId,
        removed: Option<Vec<NodeId>>,
    ) -> Result<()> {
        if let Some(removed) = removed {
            let node = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid mutation parent".into()))?;
            let added: Vec<_> = node.children_it(false).map(|node| node.id).collect();
            if !added.is_empty() || !removed.is_empty() {
                self.queue_mutation(&Record::children(id, added, removed, None, None))?;
            }
        }
        Ok(())
    }
    pub(super) fn mutation_call(
        &mut self,
        observer: usize,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        match operation {
            "new" => {
                let mut arena = self.mutations.borrow_mut();
                if arena.observers.len() >= 128 {
                    return Err(Error::Limit("mutation observer count"));
                }
                if arena.observers.contains_key(&observer) {
                    return Err(Error::Dom("duplicate mutation observer".into()));
                }
                arena.observers.insert(observer, Queue::default());
                Ok(Value::Null)
            }
            "observe" => self.mutation_observe(observer, value),
            "disconnect" => {
                let mut arena = self.mutations.borrow_mut();
                arena.drain(observer, true)?;
                arena
                    .registrations
                    .retain(|entry| entry.observer != observer);
                Ok(Value::Null)
            }
            "pending" => Ok(json!(
                self.mutations
                    .borrow()
                    .observers
                    .iter()
                    .filter(|(_, queue)| queue.pending)
                    .map(|(id, _)| *id)
                    .collect::<Vec<_>>()
            )),
            "take" | "notify" => {
                let records = self
                    .mutations
                    .borrow_mut()
                    .drain(observer, operation == "notify")?;
                Ok(Value::Array(
                    records
                        .into_iter()
                        .map(|record| self.mutation_value(record))
                        .collect(),
                ))
            }
            _ => Err(Error::Dom("invalid mutation observer operation".into())),
        }
    }

    fn mutation_observe(&mut self, observer: usize, value: &str) -> Result<Value> {
        let (handle, options): (usize, Options) = serde_json::from_str(value)?;
        let target = match self.handles.get(handle) {
            Some(Handle::Node(id)) => Some(*id),
            Some(Handle::Attribute) => None,
            None => return Err(Error::Dom("invalid observation target".into())),
        };
        if !(options.child_list || options.attributes || options.character_data)
            || (options.attribute_old_value || options.attribute_filter.is_some())
                && !options.attributes
            || options.character_data_old_value && !options.character_data
        {
            return Err(Error::Dom("invalid mutation observation options".into()));
        }
        if options
            .attribute_filter
            .as_ref()
            .is_some_and(|names| names.len() > 128 || names.iter().any(|name| name.len() > 512))
        {
            return Err(Error::Limit("mutation attribute filter"));
        }
        let mut arena = self.mutations.borrow_mut();
        if !arena.observers.contains_key(&observer) {
            return Err(Error::Dom("invalid mutation observer".into()));
        }
        arena
            .registrations
            .retain(|entry| entry.source != Some((observer, handle)));
        if let Some(existing) = arena.registrations.iter_mut().find(|entry| {
            entry.observer == observer && entry.handle == handle && entry.source.is_none()
        }) {
            existing.options = options;
        } else {
            if arena.registrations.len() >= 1024 {
                return Err(Error::Limit("mutation registrations"));
            }
            arena.registrations.push(Registration {
                observer,
                target,
                handle,
                options,
                source: None,
            });
        }
        Ok(Value::Null)
    }

    pub(super) fn queue_mutation(&self, record: &Record) -> Result<()> {
        if !self.mutations.borrow().active() {
            return Ok(());
        }
        let mut arena = self.mutations.borrow_mut();
        let ancestors = self.mutation_ancestors(record.target, &mut arena)?;
        let mut interested = BTreeMap::<usize, bool>::new();
        for registration in &arena.registrations {
            if registration.options.accepts(record)
                && registration.target.is_some_and(|id| {
                    id == record.target || registration.options.subtree && ancestors.contains(&id)
                })
            {
                *interested.entry(registration.observer).or_default() |=
                    registration.options.old(record.kind);
            }
        }
        for (observer, old) in interested {
            let mut record = record.clone();
            if !old {
                record.old = None;
            }
            let bytes = record.bytes();
            if arena.records >= 4096 || arena.bytes.saturating_add(bytes) > 4 * 1024 * 1024 {
                return Err(Error::Limit("mutation records"));
            }
            arena.records = arena.records.saturating_add(1);
            arena.bytes = arena.bytes.saturating_add(bytes);
            let queue = arena
                .observers
                .get_mut(&observer)
                .ok_or_else(|| Error::Dom("invalid mutation queue".into()))?;
            queue.records.push(record);
            queue.pending = true;
        }
        Ok(())
    }

    pub(super) fn mutation_detaching(&self, node: NodeId, parent: NodeId) -> Result<()> {
        if !self.mutations.borrow().active() {
            return Ok(());
        }
        let mut arena = self.mutations.borrow_mut();
        let ancestors = self.mutation_ancestors(parent, &mut arena)?;
        let transient: Vec<_> = arena
            .registrations
            .iter()
            .filter(|entry| {
                entry.options.subtree
                    && entry
                        .target
                        .is_some_and(|id| id == parent || ancestors.contains(&id))
            })
            .cloned()
            .collect();
        for mut entry in transient {
            let source = entry.source.unwrap_or((entry.observer, entry.handle));
            if arena
                .registrations
                .iter()
                .any(|other| other.source == Some(source) && other.target == Some(node))
            {
                continue;
            }
            if arena.registrations.len() >= 1024 {
                return Err(Error::Limit("mutation registrations"));
            }
            entry.source = Some(source);
            entry.target = Some(node);
            if let Some(queue) = arena.observers.get_mut(&entry.observer) {
                queue.pending = true;
            }
            arena.registrations.push(entry);
        }
        Ok(())
    }

    fn mutation_ancestors(&self, id: NodeId, arena: &mut Arena) -> Result<HashSet<NodeId>> {
        let mut work = crate::layout::Work::new(
            &mut arena.work,
            self.limits
                .max_dom_operations
                .saturating_sub(self.operations),
            self.limits.max_layout_nodes,
        );
        for _ in &arena.registrations {
            work.charge()?;
        }
        let mut ancestors = HashSet::new();
        if arena
            .registrations
            .iter()
            .any(|entry| entry.options.subtree)
        {
            let target = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid mutation target".into()))?;
            for parent in target.ancestors_it(None) {
                work.charge()?;
                ancestors.insert(parent.id);
            }
        }
        Ok(ancestors)
    }

    fn mutation_value(&mut self, record: Record) -> Value {
        json!({"type":match record.kind { Kind::Attributes=>"attributes",Kind::CharacterData=>"characterData",Kind::Children=>"childList" },
            "target":self.handle(record.target),"attributeName":record.name,"attributeNamespace":record.namespace,"oldValue":record.old.as_deref(),
            "addedNodes":record.added.into_iter().map(|id|self.handle(id)).collect::<Vec<_>>(),"removedNodes":record.removed.into_iter().map(|id|self.handle(id)).collect::<Vec<_>>(),
            "previousSibling":record.previous.map(|id|self.handle(id)),"nextSibling":record.next.map(|id|self.handle(id)) })
    }
}
