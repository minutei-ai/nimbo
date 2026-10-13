use serde_json::{Value, json};

use super::{
    Dom,
    checkedness::{ActivationKind, Group, activation_kind, html_element},
};
use crate::{Error, Result, dom_attributes::NativeAttributes};

impl Dom {
    pub(super) fn form_call(&mut self, operation: &str, handle: usize, arg: &str) -> Result<Value> {
        match operation {
            "formOwner" => self.form_owner_call(handle),
            "formReset" => self.reset_form(handle),
            "formControl" => self.form_control(handle, arg),
            _ => Err(Error::Dom("unsupported form operation".into())),
        }
    }

    fn form_owner_call(&mut self, handle: usize) -> Result<Value> {
        let node = self.node(handle)?;
        if !["input", "textarea", "button"]
            .iter()
            .any(|kind| html_element(node, kind))
        {
            return Err(Error::Dom("invalid form-associated receiver".into()));
        }
        let (_, form) = self.control_view().form_owner(node)?;
        Ok(json!(form.map(|id| self.handle(id))))
    }

    fn form_control(&mut self, handle: usize, operation: &str) -> Result<Value> {
        let node = self.node(handle)?;
        let control = html_element(node, "input") || html_element(node, "button");
        if operation == "type" {
            return Ok(json!(if node
                .null_attribute_matches("type", |kind| kind.eq_ignore_ascii_case("reset"))
            {
                "reset"
            } else if node
                .null_attribute_matches("type", |kind| kind.eq_ignore_ascii_case("button"))
            {
                "button"
            } else {
                "submit"
            }));
        }
        if operation == "candidate" {
            return Ok(json!(if control {
                1
            } else if (html_element(node, "a") || html_element(node, "area"))
                && node.has_null_attribute("href")
            {
                2
            } else {
                0
            }));
        }
        if operation != "reset" {
            return Err(Error::Dom("unsupported form control operation".into()));
        }
        let view = self.control_view();
        if !control
            || !node.null_attribute_matches("type", |kind| kind.eq_ignore_ascii_case("reset"))
            || view.matches(node, ":disabled").unwrap_or(false)
        {
            return Ok(Value::Null);
        }
        let (_, form) = view.form_owner(node)?;
        Ok(json!(form.map(|id| self.handle(id))))
    }

    fn reset_form(&mut self, handle: usize) -> Result<Value> {
        let controls = self.form_reset_controls(handle)?;
        self.charge_pending_work()?;
        self.charge_write(controls.len())?;
        (self.check)()?;
        self.reset_controls(controls);
        Ok(Value::Null)
    }

    fn form_reset_controls(
        &self,
        handle: usize,
    ) -> Result<Vec<(dom_query::NodeId, Option<Group>)>> {
        let form = self.node(handle)?;
        if !html_element(form, "form") {
            return Err(Error::Dom("invalid form receiver".into()));
        }
        let view = self.control_view();
        let (root, _) = view.form_owner(form)?;
        let root = self
            .document
            .tree
            .get(&root)
            .ok_or_else(|| Error::Dom("invalid form root".into()))?;
        let mut controls = Vec::new();
        for candidate in std::iter::once(root).chain(root.descendants_it()) {
            view.charge()?;
            if !["input", "textarea", "select"]
                .iter()
                .any(|kind| html_element(candidate, kind))
            {
                continue;
            }
            let (root, owner) = view.form_owner(candidate)?;
            if owner != Some(form.id) {
                continue;
            }
            if html_element(candidate, "select") {
                return Err(Error::Dom("unsupported: select reset".into()));
            }
            let group = if activation_kind(candidate) == Some(ActivationKind::Radio)
                && candidate.has_null_attribute("checked")
            {
                candidate
                    .null_attribute("name")
                    .filter(|name| !name.is_empty())
                    .map(|name| Group {
                        root,
                        form: owner,
                        name,
                    })
            } else {
                None
            };
            controls.push((candidate.id, group));
        }
        Ok(controls)
    }
}

#[cfg(test)]
mod tests {
    use crate::{Error, Limits, MediaEnvironment, dom::Dom};
    use std::sync::Arc;

    #[test]
    fn rejected_reset_keeps_dirty_values_and_checkedness() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut dom = Dom::new(
            "<form id=f><input id=text value=default><input id=box type=checkbox checked></form>",
            Limits {
                max_dom_write_bytes: 6,
                ..Limits::default()
            },
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/forms")?,
            Arc::new(|| Ok(())),
        )?;
        let form: usize = serde_json::from_str(&dom.call("queryOne", 0, "#f", "")?)?;
        let text: usize = serde_json::from_str(&dom.call("queryOne", 0, "#text", "")?)?;
        let box_handle: usize = serde_json::from_str(&dom.call("queryOne", 0, "#box", "")?)?;
        dom.call("setControlValue", text, "input", "dirty")?;
        dom.call("setInputState", box_handle, "checked", "false")?;
        assert!(matches!(
            dom.call("formReset", form, "", ""),
            Err(Error::Limit("DOM write bytes"))
        ));
        assert_eq!(dom.call("controlValue", text, "input", "")?, "\"dirty\"");
        assert_eq!(dom.call("inputState", box_handle, "checked", "")?, "false");
        Ok(())
    }

    #[test]
    fn unsupported_select_reset_keeps_supported_control_state()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut dom = Dom::new(
            "<form id=f><input id=text value=default><select><option>value</option></select></form>",
            Limits::default(),
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/forms")?,
            Arc::new(|| Ok(())),
        )?;
        let form: usize = serde_json::from_str(&dom.call("queryOne", 0, "#f", "")?)?;
        let text: usize = serde_json::from_str(&dom.call("queryOne", 0, "#text", "")?)?;
        dom.call("setControlValue", text, "input", "dirty")?;
        assert!(
            matches!(dom.call("formReset", form, "", ""), Err(Error::Dom(message)) if message == "unsupported: select reset")
        );
        assert_eq!(dom.call("controlValue", text, "input", "")?, "\"dirty\"");
        Ok(())
    }
}
