use dom_query::{NodeId, NodeRef};

use super::{Dom, html_element, options};
use crate::{Error, Result, dom_attributes::NativeAttributes};

pub(in crate::dom) struct Attribute {
    node: NodeId,
    select: Option<NodeId>,
    name: &'static str,
    present: bool,
}

#[derive(Default)]
pub(in crate::dom) struct Movement {
    target: Option<NodeId>,
    roots: Vec<NodeId>,
    selects: Vec<NodeId>,
}

fn owner(node: NodeRef<'_>, dom: &Dom) -> Result<Option<NodeId>> {
    if html_element(node, "select") {
        Ok(Some(node.id))
    } else {
        Ok(dom
            .control_view()
            .option_select(node)?
            .map(|select| select.id))
    }
}

impl Dom {
    pub(in crate::dom) fn selection_before_attribute(
        &self,
        handle: usize,
        namespace: &str,
        name: &str,
        value: Option<&str>,
    ) -> Result<Option<Attribute>> {
        if !namespace.is_empty() {
            return Ok(None);
        }
        let node = self.node(handle)?;
        let name = match name {
            "selected" if html_element(node, "option") => "selected",
            "multiple" if html_element(node, "select") => "multiple",
            "size" if html_element(node, "select") => "size",
            "disabled" if html_element(node, "option") || html_element(node, "optgroup") => {
                "disabled"
            }
            _ => return Ok(None),
        };
        let present = node.has_null_attribute(name);
        let changed = match value {
            Some(value) => !node.null_attribute_matches(name, |current| current == value),
            None => present,
        };
        if !changed {
            return Ok(None);
        }
        let select = owner(node, self)?;
        if let Some(id) = select {
            let select = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid select".into()))?;
            self.selection
                .borrow_mut()
                .initialize(select, &self.control_view())?;
        }
        Ok(Some(Attribute {
            node: node.id,
            select,
            name,
            present,
        }))
    }

    pub(in crate::dom) fn selection_after_attribute(
        &self,
        attribute: Option<Attribute>,
    ) -> Result<()> {
        let Some(attribute) = attribute else {
            return Ok(());
        };
        let node = self
            .document
            .tree
            .get(&attribute.node)
            .ok_or_else(|| Error::Dom("invalid option".into()))?;
        let present = node.has_null_attribute(attribute.name);
        if attribute.name != "size" && present == attribute.present {
            return Ok(());
        }
        let mut arena = self.selection.borrow_mut();
        let dirty = arena.states.get(&node.id).is_some_and(|state| state.dirty);
        if attribute.name == "selected" && dirty {
            return Ok(());
        }
        let mut preferred = None;
        if attribute.name == "selected" && !dirty {
            arena.store(node, present, None);
            preferred = present.then_some(node.id);
        }
        if let Some(id) = attribute.select {
            let select = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid select".into()))?;
            let nodes = options::list(select, &self.control_view())?;
            arena.normalize(
                select,
                &nodes,
                preferred,
                attribute.name == "multiple" && !present,
                &self.control_view(),
            )?;
        }
        Ok(())
    }

    fn selection_prepare_node(&self, node: NodeRef<'_>, selects: &mut Vec<NodeId>) -> Result<()> {
        if let Some(id) = owner(node, self)?
            && !selects.contains(&id)
        {
            let select = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid select".into()))?;
            self.selection
                .borrow_mut()
                .initialize(select, &self.control_view())?;
            selects.push(id);
        }
        Ok(())
    }

    pub(in crate::dom) fn selection_before_move(
        &self,
        operation: &str,
        handle: usize,
        property: &str,
        value: &str,
    ) -> Result<Movement> {
        let replacing = operation == "set" && matches!(property, "innerHTML" | "textContent");
        if !self.may_have_controls.options
            || (!replacing
                && !matches!(
                    operation,
                    "append" | "insert" | "replace" | "remove" | "removeChild"
                ))
        {
            return Ok(Movement::default());
        }
        let target = self.node(handle)?;
        let mut movement = Movement {
            target: Some(target.id),
            ..Movement::default()
        };
        self.selection_prepare_node(target, &mut movement.selects)?;
        if replacing || operation == "remove" {
            movement.roots.push(target.id);
        } else {
            let incoming = self.node(
                value
                    .parse::<usize>()
                    .map_err(|error| Error::Dom(error.to_string()))?,
            )?;
            if incoming.is_fragment() {
                movement
                    .roots
                    .extend(incoming.children_it(false).map(|child| child.id));
            } else {
                movement.roots.push(incoming.id);
            }
        }
        for root in &movement.roots {
            let root = self
                .document
                .tree
                .get(root)
                .ok_or_else(|| Error::Dom("invalid moved node".into()))?;
            for node in std::iter::once(root).chain(root.descendants_it()) {
                self.control_view().charge()?;
                if html_element(node, "option") || html_element(node, "select") {
                    self.selection_prepare_node(node, &mut movement.selects)?;
                }
            }
        }
        Ok(movement)
    }

    pub(in crate::dom) fn selection_after_move(&self, movement: Movement) -> Result<()> {
        let mut selects = movement.selects;
        let mut preferred = std::collections::HashMap::new();
        if let Some(id) = movement.target {
            let target = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid moved target".into()))?;
            if let Some(id) = owner(target, self)?
                && !selects.contains(&id)
            {
                selects.push(id);
            }
        }
        for root in movement.roots {
            let root = self
                .document
                .tree
                .get(&root)
                .ok_or_else(|| Error::Dom("invalid moved node".into()))?;
            for node in std::iter::once(root).chain(root.descendants_it()) {
                self.control_view().charge()?;
                if !html_element(node, "option") {
                    continue;
                }
                if let Some(id) = owner(node, self)? {
                    if !selects.contains(&id) {
                        selects.push(id);
                    }
                    if self.selection.borrow().current(node) {
                        preferred.insert(id, node.id);
                    }
                }
            }
        }
        let mut arena = self.selection.borrow_mut();
        for id in selects {
            let select = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid select".into()))?;
            let nodes = options::list(select, &self.control_view())?;
            arena.normalize(
                select,
                &nodes,
                preferred.get(&id).copied(),
                false,
                &self.control_view(),
            )?;
            arena.initialized.insert(id);
        }
        Ok(())
    }
}
