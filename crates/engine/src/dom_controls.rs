use dom_query::{NodeData, NodeRef};
use serde_json::{Value, json};

use crate::{Error, Result, dom::Dom, dom_attributes::NativeAttributes};

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
            self.charge_write(value.len())?;
            let value = sanitize(node, kind, value)?;
            self.control_values.insert(id, value);
            return Ok(Value::Null);
        }
        if let Some(value) = self.control_values.get(&id) {
            return Ok(json!(sanitize(node, kind, value)?));
        }
        let value = if kind == "input" {
            node.null_attribute("value").unwrap_or_default()
        } else {
            self.control_default_text(node)?
        };
        Ok(json!(sanitize(node, kind, &value)?))
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
        Ok(json!(self.control_default_text(node)?))
    }
}
