//! Shape unadorned inline wrappers together, preserving word boundaries and kerning.
use super::{BoxContext, Tree, non_layout, unsupported};
use crate::{
    Error, Result,
    styles::{Declarations, Variables},
};
use dom_query::{NodeId, NodeRef};

impl Tree<'_, '_> {
    pub(super) fn inline_source(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        variables: &Variables,
        context: &BoxContext,
        source: &mut String,
        folded: &mut Vec<NodeId>,
    ) -> Result<bool> {
        for child in node.children_it(false) {
            self.visit(depth.saturating_add(1))?;
            if child.is_text() {
                let text = child.text();
                if source.len().saturating_add(text.len()) > 65_536 {
                    return Err(Error::Limit("layout text source"));
                }
                source.push_str(&text);
                continue;
            }
            if !child.is_element() || super::non_rendered(child) {
                continue;
            }
            let (declarations, inherited) = self.resolve_node(child, variables)?;
            let display = context
                .display
                .compute(child, &declarations, false, false)?;
            if display.none() {
                continue;
            }
            if !["span", "a", "label", "abbr"]
                .iter()
                .any(|name| child.has_name(name))
                || display.value()? != "inline"
            {
                return Ok(false);
            }
            // Inline borders, padding, positioning and differing fonts require fragments.
            if let Some((name, _, _)) = declarations
                .layout_entries()
                .find(|(name, value, deferred)| *deferred || !inert(name, value))
            {
                return Err(Error::Dom(format!(
                    "layout unsupported: inline text property ({name})"
                )));
            }
            let computed = context.compute(
                &declarations,
                false,
                child,
                display,
                &self.fonts.borrow(),
                self.work,
            )?;
            if !same_metrics(&computed, context)? {
                return Ok(false);
            }
            for kind in [
                crate::cascade::Generated::Before,
                crate::cascade::Generated::After,
            ] {
                let generated = self.cascade.resolve(
                    child,
                    &Declarations::default(),
                    Some(kind),
                    self.containers,
                    self.work,
                )?;
                if !matches!(
                    generated.value("content").0.as_str(),
                    "" | "none" | "normal" | "initial" | "unset"
                ) {
                    return Err(unsupported("generated content in inline text"));
                }
            }
            if !self.inline_source(
                child,
                depth.saturating_add(1),
                &inherited,
                &computed,
                source,
                folded,
            )? {
                return Ok(false);
            }
            folded.push(child.id);
        }
        Ok(true)
    }
}

fn inert(name: &str, value: &str) -> bool {
    name == "display"
        || name.starts_with("font-")
        || name.starts_with("text-")
        || name == "line-height"
        || name == "letter-spacing"
        || non_layout(name)
        || crate::outlines::property(name)
        || name == "box-sizing" && matches!(value, "content-box" | "border-box")
        || (name.starts_with("margin-")
            || name.starts_with("padding-")
            || name.ends_with("-width") && name.starts_with("border-"))
            && matches!(value, "0" | "0px")
        || name.starts_with("border-")
            && name.ends_with("-style")
            && matches!(value, "none" | "solid")
}

fn same_metrics(computed: &BoxContext, inherited: &BoxContext) -> Result<bool> {
    let border = computed.borders.geometry()?;
    Ok([border.left, border.right, border.top, border.bottom]
        .iter()
        .all(|width| *width == taffy::LengthPercentage::length(0.0))
        && computed.fonts == inherited.fonts
        && computed.typography == inherited.typography
        && computed.family == inherited.family)
}
