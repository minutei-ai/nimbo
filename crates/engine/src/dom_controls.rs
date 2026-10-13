use dom_query::{NodeData, NodeRef};
use serde_json::Value;

use crate::{Error, Result, dom::Dom, dom_attributes::NativeAttributes};

#[derive(Clone, Copy, PartialEq, Eq)]
enum ValueMode {
    Value,
    Default,
    DefaultOn,
    Filename,
}

fn mode(node: NodeRef<'_>) -> ValueMode {
    match node
        .null_attribute("type")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "hidden" | "submit" | "image" | "reset" | "button" => ValueMode::Default,
        "checkbox" | "radio" => ValueMode::DefaultOn,
        "file" => ValueMode::Filename,
        _ => ValueMode::Value,
    }
}

pub(super) struct TypeTransition {
    previous: ValueMode,
    value: Option<String>,
}

fn html_space(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\r' | '\x0c' | ' ')
}

fn sanitize(node: NodeRef<'_>, kind: &str, value: &str) -> Result<String> {
    if kind == "textarea" {
        return Ok(value.replace("\r\n", "\n").replace('\r', "\n"));
    }
    let input_type = node
        .null_attribute("type")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let value = value.replace(['\r', '\n'], "");
    match input_type.as_str() {
        "email" if node.null_attribute("multiple").is_some() => Ok(value
            .split(',')
            .map(|item| item.trim_matches(html_space))
            .collect::<Vec<_>>()
            .join(",")),
        "email" | "url" => Ok(value.trim_matches(html_space).to_owned()),
        "hidden" | "date" | "month" | "week" | "time" | "datetime-local" | "number" | "range"
        | "color" | "checkbox" | "radio" | "file" | "submit" | "image" | "reset" | "button" => {
            Err(Error::Dom("unsupported: input value state".into()))
        }
        _ => Ok(value),
    }
}

impl Dom {
    pub(super) fn control_before_type(
        &self,
        handle: usize,
        namespace: &str,
        name: &str,
    ) -> Result<Option<TypeTransition>> {
        if !namespace.is_empty() || name != "type" {
            return Ok(None);
        }
        let node = self.node(handle)?;
        if !node.query_or(false, |data| matches!(&data.data, NodeData::Element(element) if element.name.ns.as_ref()=="http://www.w3.org/1999/xhtml" && element.name.local.as_ref()=="input")) { return Ok(None); }
        let previous = mode(node);
        let value = if previous == ValueMode::Value {
            self.control_values.get(&node.id).cloned()
        } else {
            None
        };
        Ok(Some(TypeTransition { previous, value }))
    }

    pub(super) fn control_after_type(
        &mut self,
        handle: usize,
        transition: Option<TypeTransition>,
    ) -> Result<()> {
        let Some(transition) = transition else {
            return Ok(());
        };
        let node = self.node(handle)?;
        let id = node.id;
        let current = mode(node);
        if transition.previous == ValueMode::Value
            && matches!(current, ValueMode::Default | ValueMode::DefaultOn)
        {
            if let Some(value) = transition.value.filter(|value| !value.is_empty()) {
                self.write_value("setAttr", handle, "value", &value)?;
                self.sync_attributes(id);
            }
            self.control_values.remove(&id);
        } else if transition.previous != ValueMode::Value && current == ValueMode::Value {
            self.control_values.remove(&id);
        }
        Ok(())
    }

    pub(super) fn sync_control_value(&mut self, operation: &str, handle: usize) -> Result<()> {
        if !matches!(
            operation,
            "setAttr" | "removeAttr" | "setAttrNS" | "removeAttrNS" | "attributeNode"
        ) {
            return Ok(());
        }
        let id = self.node_id(handle)?;
        let Some(previous) = self.control_values.remove(&id) else {
            return Ok(());
        };
        let node = self.node(handle)?;
        let kind = if node.has_name("textarea") {
            "textarea"
        } else {
            "input"
        };
        let current = sanitize(node, kind, &previous).unwrap_or(previous);
        self.control_values.insert(id, current);
        Ok(())
    }

    pub(super) fn control_call(
        &mut self,
        operation: &str,
        handle: usize,
        kind: &str,
        value: &str,
    ) -> Result<Value> {
        match operation {
            "controlValue" => self.control_value(handle, kind, None),
            "setControlValue" => self.control_value(handle, kind, Some(value)),
            "controlDefault" => self.control_default(handle),
            _ => Err(Error::Dom("unsupported control operation".into())),
        }
    }

    pub(super) fn control_value(
        &mut self,
        handle: usize,
        kind: &str,
        value: Option<&str>,
    ) -> Result<Value> {
        let id = self.node_id(handle)?;
        let document = std::rc::Rc::clone(&self.document);
        let node = document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid control".into()))?;
        if !matches!(kind, "input" | "textarea")
            || !node.query_or(false, |data| {
                matches!(&data.data, NodeData::Element(element)
                if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml"
                && element.name.local.as_ref() == kind)
            })
        {
            return Err(Error::Dom("invalid control receiver".into()));
        }
        if let Some(value) = value {
            if kind == "input" && matches!(mode(node), ValueMode::Default | ValueMode::DefaultOn) {
                self.write_value("setAttr", handle, "value", value)?;
                self.control_values.remove(&id);
                self.sync_attributes(id);
                return Ok(Value::Null);
            }
            self.charge_write(value.len())?;
            let value = sanitize(node, kind, value)?;
            self.control_values.insert(id, value);
            return Ok(Value::Null);
        }
        if kind == "input" && matches!(mode(node), ValueMode::Default | ValueMode::DefaultOn) {
            return Ok(Value::String(node.null_attribute("value").unwrap_or_else(
                || {
                    if mode(node) == ValueMode::DefaultOn {
                        "on".into()
                    } else {
                        String::new()
                    }
                },
            )));
        }
        if let Some(value) = self.control_values.get(&id) {
            return Ok(Value::String(sanitize(node, kind, value)?));
        }
        let value = if kind == "input" {
            node.null_attribute("value").unwrap_or_default()
        } else {
            self.control_default_text(node)?
        };
        Ok(Value::String(sanitize(node, kind, &value)?))
    }

    fn control_default_text(&mut self, node: NodeRef<'_>) -> Result<String> {
        let mut value = String::new();
        for child in node.children_it(false) {
            if self.operations >= self.limits.max_dom_operations {
                return Err(Error::Limit("DOM operations"));
            }
            self.operations = self.operations.saturating_add(1);
            if child.is_text() {
                value.push_str(&child.text());
            }
        }
        Ok(value)
    }

    pub(super) fn control_default(&mut self, handle: usize) -> Result<Value> {
        let id = self.node_id(handle)?;
        let document = std::rc::Rc::clone(&self.document);
        let node = document
            .tree
            .get(&id)
            .ok_or_else(|| Error::Dom("invalid control".into()))?;
        Ok(Value::String(self.control_default_text(node)?))
    }
}
