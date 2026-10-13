#[path = "dom_selection_mutations.rs"]
mod mutations;
#[path = "dom_selection_resize.rs"]
mod resize;

use std::collections::{HashMap, HashSet};

use dom_query::{NodeId, NodeRef};
use serde_json::{Value, json};

use super::{Dom, checkedness::html_element, control_selectors::View, options};
use crate::{Error, Result, dom_attributes::NativeAttributes};

#[derive(Clone, Copy)]
struct State {
    selected: bool,
    dirty: bool,
}

#[derive(Default)]
pub(super) struct Arena {
    states: HashMap<NodeId, State>,
    initialized: HashSet<NodeId>,
}

fn size(select: NodeRef<'_>, view: &View<'_>) -> Result<u32> {
    let mut result = Ok(0);
    select.null_attribute_matches("size", |value| {
        let digits = value.trim_start_matches([' ', '\t', '\n', '\r', '\x0c']);
        let digits = digits.strip_prefix('+').unwrap_or(digits);
        let mut size = 0_u32;
        for (index, digit) in digits.bytes().take_while(u8::is_ascii_digit).enumerate() {
            if index.is_multiple_of(8192)
                && let Err(error) = view.charge()
            {
                result = Err(error);
                return false;
            }
            let Some(next) = size
                .checked_mul(10)
                .and_then(|size| size.checked_add(u32::from(digit.saturating_sub(b'0'))))
            else {
                return false;
            };
            size = next;
        }
        result = Ok(size);
        true
    });
    result
}

fn dropdown(select: NodeRef<'_>, view: &View<'_>) -> Result<bool> {
    Ok(size(select, view)? <= 1)
}

struct Choice {
    selected: Option<NodeId>,
    fallback: bool,
}

impl Arena {
    fn current(&self, node: NodeRef<'_>) -> bool {
        self.states.get(&node.id).map_or_else(
            || node.has_null_attribute("selected"),
            |state| state.selected,
        )
    }

    fn store(&mut self, node: NodeRef<'_>, selected: bool, dirty: Option<bool>) {
        let dirty =
            dirty.unwrap_or_else(|| self.states.get(&node.id).is_some_and(|state| state.dirty));
        if dirty || selected != node.has_null_attribute("selected") {
            self.states.insert(node.id, State { selected, dirty });
        } else {
            self.states.remove(&node.id);
        }
    }

    fn initialize(&mut self, select: NodeRef<'_>, view: &View<'_>) -> Result<()> {
        if self.initialized.contains(&select.id) {
            return Ok(());
        }
        let nodes = options::list(select, view)?;
        self.normalize(select, &nodes, None, false, view)?;
        self.initialized.insert(select.id);
        Ok(())
    }

    fn choice(
        &self,
        select: NodeRef<'_>,
        nodes: &[NodeId],
        override_state: Option<(NodeId, bool)>,
        first: bool,
        view: &View<'_>,
    ) -> Result<Choice> {
        let mut selected = override_state
            .filter(|(_, selected)| *selected)
            .map(|(id, _)| id);
        let preferred = selected.is_some();
        let mut enabled = None;
        for id in nodes {
            view.charge()?;
            let node = view
                .document
                .tree
                .get(id)
                .ok_or_else(|| Error::Dom("invalid option".into()))?;
            let current = override_state
                .filter(|(changed, _)| changed == id)
                .map_or_else(|| self.current(node), |(_, selected)| selected);
            if !preferred && current && (!first || selected.is_none()) {
                selected = Some(*id);
            }
            if enabled.is_none() && !view.disabled(node)? {
                enabled = Some(*id);
            }
        }
        let fallback = selected.is_none() && dropdown(select, view)?;
        if fallback {
            selected = enabled;
        }
        Ok(Choice { selected, fallback })
    }

    fn apply(&mut self, nodes: &[NodeId], choice: &Choice, view: &View<'_>) -> Result<()> {
        for id in nodes {
            let node = view
                .document
                .tree
                .get(id)
                .ok_or_else(|| Error::Dom("invalid option".into()))?;
            self.store(
                node,
                choice.selected == Some(*id),
                (choice.fallback && choice.selected == Some(*id)).then_some(false),
            );
        }
        Ok(())
    }

    fn normalize(
        &mut self,
        select: NodeRef<'_>,
        nodes: &[NodeId],
        preferred: Option<NodeId>,
        first: bool,
        view: &View<'_>,
    ) -> Result<()> {
        if select.has_null_attribute("multiple") {
            return Ok(());
        }
        let selected = self.choice(select, nodes, preferred.map(|id| (id, true)), first, view)?;
        self.apply(nodes, &selected, view)
    }

    pub(super) fn selected(&mut self, node: NodeRef<'_>, view: &View<'_>) -> Result<bool> {
        if let Some(select) = view.option_select(node)? {
            self.initialize(select, view)?;
        }
        Ok(self.current(node))
    }
}

impl Dom {
    pub(super) fn selection_call(
        &mut self,
        handle: usize,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        let id = self.node_id(handle)?;
        let document = std::rc::Rc::clone(&self.document);
        let node = document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid selection receiver".into()))?;
        if html_element(node, "option") {
            return self.option_selection(node, operation, value);
        }
        if !html_element(node, "select") {
            return Err(Error::Dom("invalid selection receiver".into()));
        }
        if operation == "size" {
            let size = size(node, &self.control_view())?;
            return Ok(json!(if size <= i32::MAX.unsigned_abs() {
                size
            } else {
                0
            }));
        }
        if matches!(operation, "item" | "namedItem") {
            return self.selection_item(node, operation, value);
        }
        if operation == "length" {
            return self.selection_read(node, operation);
        }
        self.selection
            .borrow_mut()
            .initialize(node, &self.control_view())?;
        if matches!(operation, "selectedItem" | "selectedNamedItem") {
            return self.selection_item(node, operation, value);
        }
        if operation == "setLength" {
            return self.selection_resize(node, value);
        }
        if operation.starts_with("set") {
            let nodes = options::list(node, &self.control_view())?;
            return self.set_selection(&nodes, operation, value);
        }
        if matches!(operation, "selectedIndex" | "value" | "selectedLength") {
            return self.selection_read(node, operation);
        }
        if !matches!(operation, "options" | "selectedOptions") {
            return Err(Error::Dom("unsupported select operation".into()));
        }
        let mut ids = Vec::new();
        options::visit(node, &self.control_view(), |option| {
            if operation == "options" || self.selection.borrow().current(option) {
                ids.push(option.id);
            }
            Ok(true)
        })?;
        Ok(Value::Array(
            ids.into_iter()
                .map(|id| Value::Number(self.handle(id).into()))
                .collect(),
        ))
    }

    fn selection_item(
        &mut self,
        select: NodeRef<'_>,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        let index = value.parse::<usize>().ok();
        let mut position: usize = 0;
        let mut found = None;
        options::visit(select, &self.control_view(), |option| {
            if operation.starts_with("selected") && !self.selection.borrow().current(option) {
                return Ok(true);
            }
            let matches = if matches!(operation, "item" | "selectedItem") {
                index == Some(position)
            } else {
                !value.is_empty()
                    && (option.null_attribute_matches("id", |id| id == value)
                        || option.null_attribute_matches("name", |name| name == value))
            };
            if matches {
                found = Some(option.id);
                return Ok(false);
            }
            position = position.saturating_add(1);
            Ok(true)
        })?;
        Ok(json!(found.map(|id| self.handle(id))))
    }

    fn selection_read(&self, select: NodeRef<'_>, operation: &str) -> Result<Value> {
        let mut count: usize = 0;
        let mut chosen = None;
        options::visit(select, &self.control_view(), |option| {
            let selected = self.selection.borrow().current(option);
            if selected && matches!(operation, "value" | "selectedIndex") {
                chosen = Some(option.id);
                return Ok(false);
            }
            if operation != "selectedLength" || selected {
                count = count.saturating_add(1);
            }
            Ok(true)
        })?;
        match operation {
            "value" => Ok(Value::String(match chosen {
                Some(id) => options::value(
                    self.document
                        .tree
                        .get(&id)
                        .ok_or_else(|| Error::Dom("invalid option".into()))?,
                    &self.control_view(),
                )?,
                None => String::new(),
            })),
            "selectedIndex" => Ok(if chosen.is_some() {
                json!(count)
            } else {
                json!(-1)
            }),
            _ => Ok(json!(count)),
        }
    }

    fn option_selection(
        &mut self,
        node: NodeRef<'_>,
        operation: &str,
        value: &str,
    ) -> Result<Value> {
        if operation == "selected" {
            return Ok(json!(
                self.selection
                    .borrow_mut()
                    .selected(node, &self.control_view())?
            ));
        }
        if !matches!(operation, "setSelected" | "setFactorySelected") {
            return Err(Error::Dom("unsupported option selection operation".into()));
        }
        self.selection
            .borrow_mut()
            .selected(node, &self.control_view())?;
        if operation == "setSelected" && self.selection.borrow().current(node) == (value == "true")
        {
            self.charge_pending_work()?;
            self.charge_write(1)?;
            return Ok(Value::Null);
        }
        let select = self.control_view().option_select(node)?;
        let nodes = match select {
            Some(select) => options::list(select, &self.control_view())?,
            None => Vec::new(),
        };
        let single = select.filter(|select| !select.has_null_attribute("multiple"));
        let chosen = match single {
            Some(select) => self.selection.borrow().choice(
                select,
                &nodes,
                Some((node.id, value == "true")),
                false,
                &self.control_view(),
            )?,
            None => Choice {
                selected: None,
                fallback: false,
            },
        };
        self.charge_pending_work()?;
        self.charge_write(nodes.len().saturating_add(1))?;
        let mut arena = self.selection.borrow_mut();
        let selected = if single.is_some() {
            arena.apply(&nodes, &chosen, &self.control_view())?;
            arena.current(node)
        } else {
            value == "true"
        };
        arena.store(
            node,
            selected,
            Some(
                operation != "setFactorySelected"
                    && !(chosen.fallback && chosen.selected == Some(node.id)),
            ),
        );
        Ok(Value::Null)
    }

    fn set_selection(&mut self, nodes: &[NodeId], operation: &str, value: &str) -> Result<Value> {
        let mut chosen = None;
        match operation {
            "setSelectedIndex" => {
                let index = value.parse::<usize>().ok();
                chosen = index.and_then(|index| nodes.get(index).copied());
            }
            "setValue" => {
                for id in nodes {
                    let option = self
                        .document
                        .tree
                        .get(id)
                        .ok_or_else(|| Error::Dom("invalid option".into()))?;
                    if options::value_matches(option, value, &self.control_view())? {
                        chosen = Some(*id);
                        break;
                    }
                }
            }
            _ => return Err(Error::Dom("unsupported select write".into())),
        }
        self.charge_pending_work()?;
        self.charge_write(nodes.len().saturating_add(value.len()))?;
        let mut arena = self.selection.borrow_mut();
        for id in nodes {
            let option = self
                .document
                .tree
                .get(id)
                .ok_or_else(|| Error::Dom("invalid option".into()))?;
            arena.store(
                option,
                chosen == Some(*id),
                (chosen == Some(*id)).then_some(true),
            );
        }
        Ok(Value::Null)
    }
}

pub(super) struct Reset {
    select: NodeId,
    nodes: Vec<NodeId>,
    selected: Option<NodeId>,
    multiple: bool,
}

impl Dom {
    pub(super) fn selection_reset_prepare(
        &self,
        controls: impl Iterator<Item = NodeId>,
    ) -> Result<Vec<Reset>> {
        let mut plans = Vec::new();
        for id in controls {
            let select = self
                .document
                .tree
                .get(&id)
                .ok_or_else(|| Error::Dom("invalid reset control".into()))?;
            if !html_element(select, "select") {
                continue;
            }
            let nodes = options::list(select, &self.control_view())?;
            let mut selected = None;
            let mut enabled = None;
            for id in &nodes {
                self.control_view().charge()?;
                let option = self
                    .document
                    .tree
                    .get(id)
                    .ok_or_else(|| Error::Dom("invalid reset option".into()))?;
                if option.has_null_attribute("selected") {
                    selected = Some(*id);
                }
                if enabled.is_none() && !self.control_view().disabled(option)? {
                    enabled = Some(*id);
                }
            }
            if selected.is_none() && dropdown(select, &self.control_view())? {
                selected = enabled;
            }
            plans.push(Reset {
                select: select.id,
                nodes,
                selected,
                multiple: select.has_null_attribute("multiple"),
            });
        }
        Ok(plans)
    }

    pub(super) fn selection_reset_bytes(plans: &[Reset]) -> usize {
        plans
            .iter()
            .fold(0, |bytes, plan| bytes.saturating_add(plan.nodes.len()))
    }

    pub(super) fn selection_reset_apply(&self, plans: Vec<Reset>) -> Result<()> {
        let mut arena = self.selection.borrow_mut();
        for plan in plans {
            for id in plan.nodes {
                let option = self
                    .document
                    .tree
                    .get(&id)
                    .ok_or_else(|| Error::Dom("invalid reset option".into()))?;
                arena.store(
                    option,
                    if plan.multiple {
                        option.has_null_attribute("selected")
                    } else {
                        plan.selected == Some(id)
                    },
                    Some(false),
                );
            }
            arena.initialized.insert(plan.select);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{Error, Limits, MediaEnvironment, dom::Dom};
    use std::sync::Arc;

    fn dom(html: &str, limits: Limits) -> Result<Dom, Box<dyn std::error::Error>> {
        Ok(Dom::new(
            html,
            limits,
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/selects")?,
            Arc::new(|| Ok(())),
        )?)
    }

    #[test]
    fn scalar_reads_and_index_lookup_keep_handles_lazy() -> Result<(), Box<dyn std::error::Error>> {
        let mut dom = dom(
            &format!(
                "<select id=s multiple>{}</select>",
                "<option selected>text</option>".repeat(64)
            ),
            Limits::default(),
        )?;
        let select: usize = serde_json::from_str(&dom.call("queryOne", 0, "#s", "")?)?;
        let handles = dom.resource_usage().2;
        assert_eq!(dom.call("selection", select, "length", "")?, "64");
        assert_eq!(dom.call("selection", select, "selectedLength", "")?, "64");
        assert_eq!(dom.call("selection", select, "selectedIndex", "")?, "0");
        assert_eq!(dom.call("selection", select, "value", "")?, "\"text\"");
        assert_eq!(dom.resource_usage().2, handles);
        dom.call("selection", select, "item", "32")?;
        assert_eq!(dom.resource_usage().2, handles.saturating_add(1));
        assert!(dom.selection.borrow().states.is_empty());
        Ok(())
    }

    #[test]
    fn native_resize_keeps_large_lists_bounded_without_eager_handles()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut dom = dom(
            "<select id=s></select>",
            Limits {
                max_dom_nodes: 4096,
                ..Limits::default()
            },
        )?;
        let select: usize = serde_json::from_str(&dom.call("queryOne", 0, "#s", "")?)?;
        let handles = dom.resource_usage().2;
        dom.call("selection", select, "setLength", "1000")?;
        assert_eq!(dom.call("selection", select, "length", "")?, "1000");
        assert_eq!(dom.call("selection", select, "selectedIndex", "")?, "0");
        assert_eq!(dom.resource_usage().2, handles);
        assert_eq!(dom.selection.borrow().states.len(), 1);
        assert!(matches!(
            dom.call("selection", select, "setLength", "5000"),
            Err(Error::Limit("DOM nodes"))
        ));
        assert_eq!(dom.node(select)?.children_it(false).count(), 1000);
        dom.call("selection", select, "setLength", "10")?;
        assert_eq!(dom.call("selection", select, "length", "")?, "10");
        assert_eq!(dom.resource_usage().2, handles);
        Ok(())
    }

    #[test]
    fn rejected_option_write_and_form_reset_preserve_selection()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut dom = dom(
            "<form id=f><select id=s><option id=a>A</option><option>B</option></select></form>",
            Limits {
                max_dom_write_bytes: 4,
                ..Limits::default()
            },
        )?;
        let form: usize = serde_json::from_str(&dom.call("queryOne", 0, "#f", "")?)?;
        let select: usize = serde_json::from_str(&dom.call("queryOne", 0, "#s", "")?)?;
        let option: usize = serde_json::from_str(&dom.call("queryOne", 0, "#a", "")?)?;
        dom.call("selection", select, "setSelectedIndex", "1")?;
        assert!(matches!(
            dom.call("selection", option, "setSelected", "true"),
            Err(Error::Limit("DOM write bytes"))
        ));
        assert_eq!(dom.call("selection", select, "selectedIndex", "")?, "1");
        assert!(matches!(
            dom.call("formReset", form, "", ""),
            Err(Error::Limit("DOM write bytes"))
        ));
        assert_eq!(dom.call("selection", select, "selectedIndex", "")?, "1");
        Ok(())
    }

    #[test]
    fn reset_discards_dirty_option_records_and_keeps_only_implicit_selection()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut dom = dom(
            &format!(
                "<form id=f><select id=s>{}</select></form>",
                "<option>text</option>".repeat(64)
            ),
            Limits::default(),
        )?;
        let form: usize = serde_json::from_str(&dom.call("queryOne", 0, "#f", "")?)?;
        let select: usize = serde_json::from_str(&dom.call("queryOne", 0, "#s", "")?)?;
        for index in 0..64 {
            dom.call("selection", select, "setSelectedIndex", &index.to_string())?;
        }
        assert_eq!(dom.selection.borrow().states.len(), 64);
        dom.call("formReset", form, "", "")?;
        assert_eq!(dom.selection.borrow().states.len(), 1);
        assert_eq!(dom.call("selection", select, "selectedIndex", "")?, "0");
        Ok(())
    }
}
