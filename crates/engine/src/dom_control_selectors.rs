use std::cell::{Cell, RefCell};

use dom_query::{Document, NodeId, NodeRef};

use super::{
    checkedness::{ActivationKind, Arena, Group, activation_kind, html_element},
    shadow,
};
use crate::{BudgetCheck, Error, Result, dom_attributes::NativeAttributes};

pub(crate) struct View<'a> {
    pub(super) arena: &'a Arena,
    pub(super) document: &'a Document,
    pub(super) shadow: &'a shadow::Arena,
    pub(super) work: &'a Cell<usize>,
    pub(super) error: &'a RefCell<Option<Error>>,
    pub(super) limit: usize,
    pub(super) check: &'a BudgetCheck,
}

impl std::fmt::Debug for View<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ControlView")
            .field("work", &self.work.get())
            .finish_non_exhaustive()
    }
}

impl View<'_> {
    fn charge(&self) -> Result<()> {
        (self.check)()?;
        let work = self.work.get().saturating_add(1);
        self.work.set(work);
        if work > self.limit {
            return Err(Error::Limit("DOM operations"));
        }
        Ok(())
    }

    pub(crate) fn matches(&self, node: NodeRef<'_>, name: &str) -> Option<bool> {
        if !matches!(
            name,
            ":checked" | ":indeterminate" | ":disabled" | ":enabled"
        ) {
            return None;
        }
        if self.error.borrow().is_some() {
            return Some(false);
        }
        let result = self.charge().and_then(|()| match name {
            ":checked" => Ok(self.arena.checked(node)
                && match activation_kind(node) {
                    Some(ActivationKind::Checkbox) => !self.arena.indeterminate(node.id),
                    Some(ActivationKind::Radio) => true,
                    None => false,
                }),
            ":indeterminate" => self.indeterminate(node),
            ":disabled" => self.disabled(node),
            ":enabled" => Ok(Self::disableable(node) && !self.disabled(node)?),
            _ => Err(Error::Dom("unsupported control selector".into())),
        });
        Some(match result {
            Ok(value) => value,
            Err(error) => {
                *self.error.borrow_mut() = Some(error);
                false
            }
        })
    }

    fn disableable(node: NodeRef<'_>) -> bool {
        [
            "input", "button", "select", "textarea", "fieldset", "option", "optgroup",
        ]
        .iter()
        .any(|name| html_element(node, name))
    }

    fn disabled(&self, node: NodeRef<'_>) -> Result<bool> {
        if !Self::disableable(node) {
            return Ok(false);
        }
        if node.null_attribute("disabled").is_some() {
            return Ok(true);
        }
        if html_element(node, "optgroup") {
            return Ok(false);
        }
        if html_element(node, "option") {
            return Ok(node.parent().is_some_and(|parent| {
                html_element(parent, "optgroup") && parent.null_attribute("disabled").is_some()
            }));
        }
        for ancestor in node.ancestors_it(None) {
            self.charge()?;
            if !html_element(ancestor, "fieldset") || ancestor.null_attribute("disabled").is_none()
            {
                continue;
            }
            let mut legend = None;
            for child in ancestor.children_it(false) {
                self.charge()?;
                if html_element(child, "legend") {
                    legend = Some(child.id);
                    break;
                }
            }
            let mut exempt = false;
            if let Some(legend) = legend {
                for parent in node.ancestors_it(None) {
                    self.charge()?;
                    if parent.id == legend {
                        exempt = true;
                        break;
                    }
                    if parent.id == ancestor.id {
                        break;
                    }
                }
            }
            if !exempt {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn connected(&self, mut root: NodeId) -> Result<bool> {
        loop {
            let node = self
                .document
                .tree
                .get(&root)
                .ok_or_else(|| Error::Dom("invalid control tree".into()))?;
            if node.is_document() {
                return Ok(true);
            }
            let Some(shadow) = self.shadow.roots.get(&root) else {
                return Ok(false);
            };
            let host = self
                .document
                .tree
                .get(&shadow.host)
                .ok_or_else(|| Error::Dom("invalid control host".into()))?;
            root = host.id;
            for parent in host.ancestors_it(None) {
                self.charge()?;
                root = parent.id;
            }
        }
    }

    pub(super) fn group(&self, node: NodeRef<'_>) -> Result<Option<Group>> {
        let Some(name) = node.null_attribute("name").filter(|name| !name.is_empty()) else {
            return Ok(None);
        };
        let mut root = node.id;
        let mut form = None;
        for parent in node.ancestors_it(None) {
            self.charge()?;
            root = parent.id;
            if form.is_none() && html_element(parent, "form") {
                form = Some(parent.id);
            }
        }
        if let Some(specified) = node.null_attribute("form")
            && self.connected(root)?
        {
            form = None;
            let root_node = self
                .document
                .tree
                .get(&root)
                .ok_or_else(|| Error::Dom("invalid control root".into()))?;
            if !specified.is_empty() {
                for candidate in std::iter::once(root_node).chain(root_node.descendants_it()) {
                    self.charge()?;
                    if candidate.null_attribute("id").as_deref() == Some(&specified) {
                        form = html_element(candidate, "form").then_some(candidate.id);
                        break;
                    }
                }
            }
        }
        Ok(Some(Group { root, form, name }))
    }

    fn indeterminate(&self, node: NodeRef<'_>) -> Result<bool> {
        match activation_kind(node) {
            Some(ActivationKind::Checkbox) => Ok(self.arena.indeterminate(node.id)),
            Some(ActivationKind::Radio) => {
                if self.arena.checked(node) {
                    return Ok(false);
                }
                Ok(self
                    .group(node)?
                    .is_none_or(|group| !self.arena.group_selected(&group)))
            }
            None => Ok(html_element(node, "progress") && node.null_attribute("value").is_none()),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{Error, Limits, MediaEnvironment, dom::Dom};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[test]
    fn control_selector_walks_fail_explicitly_at_the_dom_budget()
    -> Result<(), Box<dyn std::error::Error>> {
        let html = format!(
            "<fieldset disabled>{}<button id=target></button>{}</fieldset>",
            "<fieldset>".repeat(20),
            "</fieldset>".repeat(20)
        );
        let mut dom = Dom::new(
            &html,
            Limits {
                max_dom_operations: 12,
                ..Limits::default()
            },
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/controls")?,
            Arc::new(|| Ok(())),
        )?;
        let handle: usize = serde_json::from_str(&dom.call("queryOne", 0, "#target", "")?)?;
        assert!(matches!(
            dom.call("matches", handle, ":disabled", ""),
            Err(Error::Limit("DOM operations"))
        ));
        Ok(())
    }

    #[test]
    fn canceled_control_queries_do_not_publish_false_matches()
    -> Result<(), Box<dyn std::error::Error>> {
        let canceled = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&canceled);
        let mut dom = Dom::new(
            "<button id=target></button>",
            Limits::default(),
            MediaEnvironment::default(),
            url::Url::parse("https://example.test/controls")?,
            Arc::new(move || {
                if signal.load(Ordering::Relaxed) {
                    Err(Error::Cancelled)
                } else {
                    Ok(())
                }
            }),
        )?;
        let handle: usize = serde_json::from_str(&dom.call("queryOne", 0, "#target", "")?)?;
        canceled.store(true, Ordering::Relaxed);
        assert!(matches!(
            dom.call("matches", handle, ":enabled", ""),
            Err(Error::Cancelled)
        ));
        Ok(())
    }
}
