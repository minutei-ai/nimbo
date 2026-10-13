use dom_query::{NodeData, NodeId, NodeRef};
use serde_json::{Value, json};

use super::{Dom, checkedness::html_element, control_selectors::View};
use crate::{Error, Result, dom_attributes::NativeAttributes};

// Walk borrowed nodes, skipping entire excluded subtrees without allocating a node list.
fn next<'a>(
    mut node: NodeRef<'a>,
    root: NodeId,
    descend: bool,
    view: &View<'_>,
) -> Result<Option<NodeRef<'a>>> {
    if descend && let Some(child) = node.first_child() {
        return Ok(Some(child));
    }
    loop {
        view.charge()?;
        if node.id == root {
            return Ok(None);
        }
        if let Some(sibling) = node.next_sibling() {
            return Ok(Some(sibling));
        }
        let Some(parent) = node.parent() else {
            return Ok(None);
        };
        node = parent;
    }
}

fn script(node: NodeRef<'_>) -> bool {
    node.query_or(false, |data| {
        data.as_element().is_some_and(|element| {
            element.name.local.as_ref() == "script"
                && matches!(
                    element.name.ns.as_ref(),
                    "http://www.w3.org/1999/xhtml" | "http://www.w3.org/2000/svg"
                )
        })
    })
}

fn append_text(
    node: NodeRef<'_>,
    text: &mut String,
    space: &mut bool,
    view: &View<'_>,
) -> Result<()> {
    node.query_or(Ok(()), |data| {
        let NodeData::Text { contents } = &data.data else {
            return Ok(());
        };
        for (index, character) in contents.chars().enumerate() {
            if index.is_multiple_of(8192) {
                (view.check)()?;
            }
            if matches!(character, ' ' | '\t' | '\n' | '\r' | '\x0c') {
                *space = !text.is_empty();
            } else {
                if *space {
                    text.push(' ');
                    *space = false;
                }
                text.push(character);
            }
        }
        Ok(())
    })
}

fn text(node: NodeRef<'_>, view: &View<'_>) -> Result<String> {
    let mut text = String::new();
    let mut space = false;
    let mut cursor = node.first_child();
    while let Some(child) = cursor {
        view.charge()?;
        append_text(child, &mut text, &mut space, view)?;
        cursor = next(child, node.id, !script(child), view)?;
    }
    Ok(text)
}

fn index(node: NodeRef<'_>, view: &View<'_>) -> Result<usize> {
    let Some(select) = view.option_select(node)? else {
        return Ok(0);
    };
    let mut index: usize = 0;
    let mut cursor = select.first_child();
    while let Some(candidate) = cursor {
        view.charge()?;
        if candidate.id == node.id {
            return Ok(index);
        }
        let option = html_element(candidate, "option");
        if option {
            index = index.saturating_add(1);
        }
        let mut descend = !option
            && !["select", "hr", "datalist"]
                .iter()
                .any(|name| html_element(candidate, name));
        if descend && html_element(candidate, "optgroup") {
            for parent in candidate.ancestors_it(None) {
                view.charge()?;
                if parent.id == select.id {
                    break;
                }
                if html_element(parent, "optgroup") {
                    descend = false;
                    break;
                }
            }
        }
        cursor = next(candidate, select.id, descend, view)?;
    }
    Ok(0)
}

impl Dom {
    pub(super) fn option_call(&mut self, handle: usize, operation: &str) -> Result<Value> {
        let node = self.node(handle)?;
        if !html_element(node, "option") {
            return Err(Error::Dom("invalid option receiver".into()));
        }
        let view = self.control_view();
        match operation {
            "text" => Ok(json!(text(node, &view)?)),
            "value" | "label" => Ok(json!(match node.null_attribute(operation) {
                Some(value) => value,
                None => text(node, &view)?,
            })),
            "index" => Ok(json!(index(node, &view)?)),
            "form" => {
                let form = match view.option_select(node)? {
                    Some(select) => view.form_owner(select)?.1,
                    None => None,
                };
                Ok(json!(form.map(|id| self.handle(id))))
            }
            _ => Err(Error::Dom("unsupported option operation".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    use super::text;
    use crate::{Error, Limits, MediaEnvironment, dom::Dom};

    #[test]
    fn metadata_reads_do_not_allocate_descendant_handles() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut dom = Dom::new(
            "<select><option>A</option><option id=o><span>B</span><script>ignored</script><b>C</b></option></select>",
            Limits::default(),
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/options")?,
            Arc::new(|| Ok(())),
        )?;
        let option: usize = serde_json::from_str(&dom.call("queryOne", 0, "#o", "")?)?;
        let handles = dom.resource_usage().2;
        assert_eq!(dom.call("option", option, "text", "")?, "\"BC\"");
        assert_eq!(dom.call("option", option, "index", "")?, "1");
        assert_eq!(dom.resource_usage().2, handles);
        Ok(())
    }

    #[test]
    fn normalization_charges_the_existing_dom_operation_budget()
    -> Result<(), Box<dyn std::error::Error>> {
        let dom = Dom::new(
            &format!("<option>{}</option>", "<span>x</span>".repeat(20)),
            Limits {
                max_dom_operations: 8,
                ..Limits::default()
            },
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/options")?,
            Arc::new(|| Ok(())),
        )?;
        let option = dom
            .document
            .select_single("option")
            .nodes()
            .first()
            .copied()
            .ok_or("missing option")?;
        assert!(matches!(
            text(option, &dom.control_view()),
            Err(Error::Limit("DOM operations"))
        ));
        Ok(())
    }

    #[test]
    fn long_text_normalization_checks_cancellation_inside_text_nodes()
    -> Result<(), Box<dyn std::error::Error>> {
        let active = Arc::new(AtomicBool::new(false));
        let checks = Arc::new(AtomicUsize::new(0));
        let check_active = Arc::clone(&active);
        let check_count = Arc::clone(&checks);
        let dom = Dom::new(
            &format!("<option>{}</option>", " ".repeat(20_000)),
            Limits::default(),
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/options")?,
            Arc::new(move || {
                if check_active.load(Ordering::Relaxed)
                    && check_count.fetch_add(1, Ordering::Relaxed) >= 2
                {
                    Err(Error::Cancelled)
                } else {
                    Ok(())
                }
            }),
        )?;
        let option = dom
            .document
            .select_single("option")
            .nodes()
            .first()
            .copied()
            .ok_or("missing option")?;
        active.store(true, Ordering::Relaxed);
        assert!(matches!(
            text(option, &dom.control_view()),
            Err(Error::Cancelled)
        ));
        assert_eq!(checks.load(Ordering::Relaxed), 3);
        Ok(())
    }
}
