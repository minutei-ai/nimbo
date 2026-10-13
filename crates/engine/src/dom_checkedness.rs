use dom_query::{NodeData, NodeId, NodeRef};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

use super::Dom;
use crate::{Error, Result, dom_attributes::NativeAttributes};

#[derive(Default)]
struct State {
    checked: Option<bool>,
    dirty: bool,
    indeterminate: bool,
}

#[derive(Hash, PartialEq, Eq)]
pub(super) struct Group {
    pub(super) root: NodeId,
    pub(super) form: Option<NodeId>,
    pub(super) name: String,
}

pub(super) fn html_element(node: NodeRef<'_>, name: &str) -> bool {
    node.query_or(false, |data| {
        matches!(&data.data, NodeData::Element(element)
        if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml"
        && element.name.local.as_ref() == name)
    })
}
fn input(node: NodeRef<'_>) -> bool {
    html_element(node, "input")
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ActivationKind {
    Checkbox,
    Radio,
}

pub(super) fn activation_kind(node: NodeRef<'_>) -> Option<ActivationKind> {
    node.query_or(None, |data| {
        let element = data.as_element()?;
        if element.name.ns.as_ref() != "http://www.w3.org/1999/xhtml"
            || element.name.local.as_ref() != "input"
        {
            return None;
        }
        let kind = element
            .attrs
            .iter()
            .find(|attribute| {
                attribute.name.ns.is_empty() && attribute.name.local.as_ref() == "type"
            })?
            .value
            .as_ref();
        if kind.eq_ignore_ascii_case("checkbox") {
            Some(ActivationKind::Checkbox)
        } else if kind.eq_ignore_ascii_case("radio") {
            Some(ActivationKind::Radio)
        } else {
            None
        }
    })
}
fn radio(node: NodeRef<'_>) -> bool {
    activation_kind(node) == Some(ActivationKind::Radio)
}

#[derive(Default)]
pub(super) struct Arena {
    states: HashMap<NodeId, State>,
    radios: HashSet<NodeId>,
    groups: HashMap<Rc<Group>, NodeId>,
    memberships: HashMap<NodeId, Rc<Group>>,
    external_forms: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Activation {
    checked: bool,
    indeterminate: bool,
    previous: Option<usize>,
    changed: bool,
}

impl Arena {
    pub(super) fn checked(&self, node: NodeRef<'_>) -> bool {
        self.states
            .get(&node.id)
            .and_then(|state| state.checked)
            .unwrap_or_else(|| node.has_null_attribute("checked"))
    }
    pub(super) fn indeterminate(&self, id: NodeId) -> bool {
        self.states
            .get(&id)
            .is_some_and(|state| state.indeterminate)
    }
    pub(super) fn group_selected(&self, group: &Group) -> bool {
        self.groups.contains_key(group)
    }
}

impl Dom {
    pub(super) fn checkedness_call(
        &mut self,
        handle: usize,
        property: &str,
        value: Option<bool>,
    ) -> Result<Value> {
        let node = self.node(handle)?;
        if !input(node) {
            return Err(Error::Dom("invalid input receiver".into()));
        }
        let id = node.id;
        let default = node.has_null_attribute("checked");
        if let Some(value) = value {
            self.charge_write(1)?;
            if property == "indeterminate" && !value && !self.checkedness.states.contains_key(&id) {
                return Ok(Value::Null);
            }
            let state = self.checkedness.states.entry(id).or_default();
            match property {
                "checked" => {
                    state.checked = Some(value);
                    state.dirty = true;
                }
                "indeterminate" => state.indeterminate = value,
                _ => return Err(Error::Dom("unsupported input state".into())),
            }
            if property == "checked" {
                self.checkedness_radio(id)?;
            }
            return Ok(Value::Null);
        }
        let state = self.checkedness.states.get(&id);
        match property {
            "checked" => Ok(json!(
                state.and_then(|state| state.checked).unwrap_or(default)
            )),
            "indeterminate" => Ok(json!(state.is_some_and(|state| state.indeterminate))),
            _ => Err(Error::Dom("unsupported input state".into())),
        }
    }

    pub(super) fn checkedness_attribute(
        &mut self,
        handle: usize,
        namespace: &str,
        name: &str,
    ) -> Result<()> {
        if namespace.is_empty() && name == "checked" {
            let id = self.node_id(handle)?;
            if let Some(state) = self.checkedness.states.get_mut(&id)
                && !state.dirty
            {
                state.checked = None;
            }
        }
        if namespace.is_empty() && matches!(name, "checked" | "name" | "type" | "form") {
            self.checkedness_radio(self.node_id(handle)?)?;
        }
        if namespace.is_empty()
            && name == "id"
            && self.checkedness.external_forms
            && !self.checkedness.radios.is_empty()
        {
            self.checkedness_refresh()?;
        }
        Ok(())
    }

    pub(super) fn click_disabled(&mut self, handle: usize) -> Result<Value> {
        let view = self.control_view();
        Ok(json!(
            view.matches(self.node(handle)?, ":disabled")
                .unwrap_or(false)
        ))
    }

    fn activation_type(&self, handle: usize) -> Result<Option<ActivationKind>> {
        Ok(activation_kind(self.node(handle)?))
    }

    pub(super) fn input_activation(
        &mut self,
        handle: usize,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        if operation == "start" {
            return self.start_input_activation(handle);
        }
        let snapshot: Activation = serde_json::from_str(value)?;
        let kind = self.activation_type(handle)?;
        if operation == "commit" {
            let root = self.tree_root(self.node_id(handle)?, true)?;
            let connected = self
                .document
                .tree
                .get(&root)
                .is_some_and(|node| node.is_document());
            return Ok(json!(snapshot.changed && kind.is_some() && connected));
        }
        if operation != "cancel" {
            return Err(Error::Dom("unsupported activation operation".into()));
        }
        if kind == Some(ActivationKind::Checkbox) {
            self.charge_write(2)?;
            let id = self.node_id(handle)?;
            let state = self.checkedness.states.entry(id).or_default();
            state.checked = Some(snapshot.checked);
            state.indeterminate = snapshot.indeterminate;
        } else if kind == Some(ActivationKind::Radio) {
            self.cancel_radio_activation(handle, &snapshot)?;
        }
        Ok(json!(false))
    }

    fn start_input_activation(&mut self, handle: usize) -> Result<Value> {
        let Some(kind) = self.activation_type(handle)? else {
            return Ok(Value::Null);
        };
        let id = self.node_id(handle)?;
        let checked = self.checkedness_current(id);
        let indeterminate = self
            .checkedness
            .states
            .get(&id)
            .is_some_and(|state| state.indeterminate);
        let previous = if kind == ActivationKind::Radio {
            if checked {
                Some(id)
            } else if let Some(group) = self.checkedness_group(id)? {
                self.checkedness.groups.get(&group).copied()
            } else {
                None
            }
        } else {
            None
        };
        self.charge_write(if kind == ActivationKind::Checkbox {
            2
        } else {
            1
        })?;
        let state = self.checkedness.states.entry(id).or_default();
        state.checked = Some(kind == ActivationKind::Radio || !checked);
        state.dirty = true;
        if kind == ActivationKind::Checkbox {
            state.indeterminate = false;
        }
        self.checkedness_radio(id)?;
        Ok(serde_json::to_value(Activation {
            checked,
            indeterminate,
            previous: previous.map(|id| self.handle(id)),
            changed: kind == ActivationKind::Checkbox || !checked,
        })?)
    }

    fn cancel_radio_activation(&mut self, handle: usize, snapshot: &Activation) -> Result<()> {
        let id = self.node_id(handle)?;
        if let Some(previous) = snapshot.previous {
            let previous_id = self.node_id(previous)?;
            let same_group = if previous_id == id {
                true
            } else if radio(self.node(previous)?) {
                let current = self.checkedness_group(id)?;
                current.is_some() && current == self.checkedness_group(previous_id)?
            } else {
                false
            };
            if same_group {
                self.checkedness_call(previous, "checked", Some(true))?;
            }
            // A prior selection moved out of the group leaves the clicked selection intact,
            // matching the independently tested browser behavior.
        } else {
            self.checkedness_call(handle, "checked", Some(false))?;
        }
        Ok(())
    }

    fn checkedness_work(&mut self) -> Result<()> {
        (self.check)()?;
        if self.operations >= self.limits.max_dom_operations {
            return Err(Error::Limit("DOM operations"));
        }
        self.operations = self.operations.saturating_add(1);
        Ok(())
    }

    fn checkedness_current(&self, id: NodeId) -> bool {
        self.checkedness
            .states
            .get(&id)
            .and_then(|state| state.checked)
            .unwrap_or_else(|| {
                self.document
                    .tree
                    .get(&id)
                    .is_some_and(|node| node.has_null_attribute("checked"))
            })
    }

    fn checkedness_group(&mut self, id: NodeId) -> Result<Option<Group>> {
        let document = Rc::clone(&self.document);
        let node = document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid radio".into()))?;
        self.checkedness.external_forms |= node.has_null_attribute("form");
        self.control_view().group(node)
    }

    fn checkedness_forget_group(&mut self, id: NodeId) {
        if let Some(group) = self.checkedness.memberships.remove(&id)
            && self.checkedness.groups.get(&group) == Some(&id)
        {
            self.checkedness.groups.remove(&group);
        }
    }

    fn checkedness_radio(&mut self, id: NodeId) -> Result<()> {
        self.checkedness_forget_group(id);
        let is_radio = self.document.tree.get(&id).is_some_and(radio);
        if !is_radio {
            self.checkedness.radios.remove(&id);
            return Ok(());
        }
        if !self.checkedness_current(id) {
            self.checkedness.radios.remove(&id);
            return Ok(());
        }
        let group = self.checkedness_group(id)?;
        self.checkedness_select_group(id, group);
        Ok(())
    }

    fn checkedness_select_group(&mut self, id: NodeId, group: Option<Group>) {
        self.checkedness.radios.insert(id);
        let Some(group) = group else { return };
        let group = Rc::new(group);
        let group = if let Some((key, _)) = self.checkedness.groups.get_key_value(&group) {
            Rc::clone(key)
        } else {
            group
        };
        if let Some(previous) = self.checkedness.groups.insert(Rc::clone(&group), id)
            && previous != id
        {
            let state = self.checkedness.states.entry(previous).or_default();
            state.checked = Some(false);
            state.dirty = true;
            self.checkedness.memberships.remove(&previous);
            self.checkedness.radios.remove(&previous);
        }
        self.checkedness.memberships.insert(id, group);
    }

    pub(super) fn reset_controls(&mut self, controls: Vec<(NodeId, Option<Group>)>) {
        for (id, _) in &controls {
            self.control_values.remove(id);
            self.checkedness_forget_group(*id);
            self.checkedness.radios.remove(id);
            if let Some(state) = self.checkedness.states.get_mut(id) {
                state.checked = None;
                state.dirty = false;
                if !state.indeterminate {
                    self.checkedness.states.remove(id);
                }
            }
        }
        for (id, group) in controls {
            if self.document.tree.get(&id).is_some_and(radio) && self.checkedness_current(id) {
                self.checkedness_select_group(id, group);
            }
        }
    }

    pub(super) fn checkedness_tree(&mut self, root: NodeId) -> Result<()> {
        let document = Rc::clone(&self.document);
        let node = document
            .tree
            .get(&root)
            .ok_or_else(|| Error::Dom("invalid controls root".into()))?;
        for candidate in std::iter::once(node).chain(node.descendants_it()) {
            self.checkedness_work()?;
            if radio(candidate) {
                self.checkedness_radio(candidate.id)?;
            }
        }
        Ok(())
    }

    pub(crate) fn initialize_checkedness(&mut self) -> Result<()> {
        if self.may_have_inputs {
            self.checkedness_tree(self.document.root().id)?;
        }
        Ok(())
    }

    pub(super) fn checkedness_refresh(&mut self) -> Result<()> {
        self.checkedness_moved(&[])
    }

    pub(super) fn checkedness_replacing(
        &self,
        operation: &str,
        handle: usize,
        property: &str,
    ) -> Result<Vec<NodeId>> {
        if self.checkedness.radios.is_empty()
            || operation != "set"
            || !matches!(property, "innerHTML" | "textContent")
        {
            return Ok(Vec::new());
        }
        Ok(self
            .node(handle)?
            .children_it(false)
            .map(|node| node.id)
            .collect())
    }

    pub(super) fn checkedness_inserting(
        &self,
        operation: &str,
        handle: usize,
        value: &str,
    ) -> Result<Vec<NodeId>> {
        if !self.may_have_inputs
            || !matches!(
                operation,
                "append" | "insert" | "replace" | "remove" | "removeChild"
            )
        {
            return Ok(Vec::new());
        }
        if operation == "remove" {
            return Ok(vec![self.node_id(handle)?]);
        }
        let child = self.node(
            value
                .parse()
                .map_err(|error: std::num::ParseIntError| Error::Dom(error.to_string()))?,
        )?;
        Ok(if child.is_fragment() {
            child.children_it(false).map(|node| node.id).collect()
        } else {
            vec![child.id]
        })
    }

    fn checkedness_ids_changed(&mut self, roots: &[NodeId]) -> Result<bool> {
        if !self.checkedness.external_forms {
            return Ok(false);
        }
        let document = Rc::clone(&self.document);
        for root in roots {
            let node = document
                .tree
                .get(root)
                .ok_or_else(|| Error::Dom("invalid moved controls".into()))?;
            for candidate in std::iter::once(node).chain(node.descendants_it()) {
                self.checkedness_work()?;
                if candidate.has_null_attribute("id") {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    pub(super) fn checkedness_moved(&mut self, inserted: &[NodeId]) -> Result<()> {
        if !self.may_have_inputs {
            return Ok(());
        }
        if !inserted.is_empty() && !self.checkedness_ids_changed(inserted)? {
            for id in inserted {
                self.checkedness_tree(*id)?;
            }
            return Ok(());
        }
        // Stable owners are registered first so a changed owner wins its new group.
        let ids = self.checkedness.radios.iter().copied().collect::<Vec<_>>();
        let mut radios = Vec::with_capacity(ids.len());
        for id in ids {
            let current = self.checkedness_group(id)?;
            let changed =
                current.as_ref() != self.checkedness.memberships.get(&id).map(AsRef::as_ref);
            radios.push((changed, id));
        }
        radios.sort_unstable();
        self.checkedness.groups.clear();
        self.checkedness.memberships.clear();
        // Revisit selected radios only; no native handles or JS wrappers are created.
        let document = Rc::clone(&self.document);
        for (_, id) in radios {
            self.checkedness_work()?;
            let Some(node) = document.tree.get(&id) else {
                continue;
            };
            let mut excluded = inserted.contains(&id);
            for ancestor in node.ancestors_it(None) {
                self.checkedness_work()?;
                excluded |= inserted.contains(&ancestor.id);
            }
            if !excluded {
                self.checkedness_radio(id)?;
            }
        }
        for id in inserted {
            self.checkedness_tree(*id)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Dom;
    use crate::{Limits, MediaEnvironment};
    use std::fmt::Write as _;
    use std::sync::Arc;

    #[test]
    fn clean_radio_groups_share_keys_without_handles_or_dirty_state()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut html = String::from("<body>");
        for index in 0..2000 {
            write!(html, "<input type=radio name=g{index} checked>")?;
        }
        let mut dom = Dom::new(
            &html,
            Limits::default(),
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/controls")?,
            Arc::new(|| Ok(())),
        )?;
        dom.initialize_checkedness()?;
        assert_eq!(dom.handles.len(), 1);
        assert!(dom.checkedness.states.is_empty());
        assert_eq!(dom.checkedness.groups.len(), 2000);
        assert_eq!(dom.checkedness.memberships.len(), 2000);
        for (id, group) in &dom.checkedness.memberships {
            let (key, winner) = dom
                .checkedness
                .groups
                .get_key_value(group)
                .ok_or("missing group")?;
            assert_eq!(winner, id);
            assert!(std::rc::Rc::ptr_eq(key, group));
        }
        let id = *dom
            .checkedness
            .radios
            .iter()
            .next()
            .ok_or("missing radio")?;
        let handle = dom.handle(id);
        for _ in 0..128 {
            assert_eq!(dom.call("inputState", handle, "checked", "")?, "true");
            dom.call("setInputState", handle, "indeterminate", "false")?;
        }
        assert!(dom.checkedness.states.is_empty());
        assert_eq!(dom.handles.len(), 2);
        let other_name = dom
            .checkedness
            .memberships
            .iter()
            .find(|(other, _)| **other != id)
            .map(|(_, group)| group.name.clone())
            .ok_or("missing other group")?;
        dom.call("setAttr", handle, "name", &other_name)?;
        assert_eq!(dom.checkedness.groups.len(), 1999);
        assert_eq!(dom.checkedness.states.len(), 1);
        for (id, group) in &dom.checkedness.memberships {
            let (key, winner) = dom
                .checkedness
                .groups
                .get_key_value(group)
                .ok_or("missing merged group")?;
            assert_eq!(winner, id);
            assert!(std::rc::Rc::ptr_eq(key, group));
        }
        Ok(())
    }
    #[test]
    fn repeated_reset_discards_dirty_values_without_retaining_clean_state()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut dom = Dom::new(
            &format!(
                "<form id=f>{}</form>",
                "<input value=default><input type=checkbox>".repeat(32)
            ),
            Limits::default(),
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/forms")?,
            Arc::new(|| Ok(())),
        )?;
        let form: usize = serde_json::from_str(&dom.call("queryOne", 0, "#f", "")?)?;
        let controls: Vec<usize> = serde_json::from_str(&dom.call("query", 0, "input", "")?)?;
        for pair in controls.chunks_exact(2) {
            let [text, checkbox] = pair else {
                return Err("invalid control pair".into());
            };
            dom.call("setControlValue", *text, "input", "dirty")?;
            dom.call("setInputState", *checkbox, "checked", "true")?;
        }
        assert_eq!(dom.control_values.len(), 32);
        assert_eq!(dom.checkedness.states.len(), 32);
        for _ in 0..5 {
            dom.call("formReset", form, "", "")?;
            assert!(dom.control_values.is_empty());
            assert!(dom.checkedness.states.is_empty());
            assert!(dom.checkedness.groups.is_empty());
            assert!(dom.checkedness.memberships.is_empty());
        }
        Ok(())
    }
}
