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
        source: &mut super::text_source::Source<'_>,
        folded: &mut Vec<NodeId>,
    ) -> Result<bool> {
        for child in node.children_it(false) {
            if !self.inline_child(
                child,
                depth.saturating_add(1),
                variables,
                context,
                source,
                folded,
            )? {
                return Ok(false);
            }
        }
        Ok(true)
    }
    pub(super) fn inline_child(
        &mut self,
        node: NodeRef<'_>,
        depth: usize,
        variables: &Variables,
        context: &BoxContext,
        source: &mut super::text_source::Source<'_>,
        folded: &mut Vec<NodeId>,
    ) -> Result<bool> {
        if node.is_text() {
            self.visit(depth)?;
            source.append(&node.text(), context)?;
            return Ok(true);
        }
        if !node.is_element() || super::non_rendered(node) {
            self.visit(depth)?;
            return Ok(true);
        }
        let (declarations, inherited) = self.resolve_node(node, variables)?;
        let display = context.display.compute(node, &declarations, false, false)?;
        if display.none() {
            self.visit(depth)?;
            return Ok(true);
        }
        if !["span", "a", "label", "abbr"]
            .iter()
            .any(|name| node.has_name(name))
            || display.value()? != "inline"
        {
            return Ok(false);
        }
        self.visit(depth)?;
        if let Some((name, value, _)) =
            declarations
                .layout_entries()
                .find(|(name, value, deferred)| {
                    *deferred
                        || !(inert(name, value)
                            || matches!(
                                super::logical::physical(name),
                                "padding-left" | "padding-right"
                            ))
                })
        {
            return Err(Error::Dom(format!(
                "layout unsupported: inline text property ({name}): {value:.120}"
            )));
        }
        let computed = context.compute(
            &declarations,
            false,
            node,
            display,
            &self.fonts.borrow(),
            self.work,
        )?;
        let border = computed.borders.geometry()?;
        if [border.left, border.right, border.top, border.bottom]
            .iter()
            .any(|width| *width != taffy::LengthPercentage::length(0.0))
        {
            return Err(unsupported("inline text borders"));
        }
        if !computed.typography.same_flow(&context.typography)
            || computed.fonts.rtl() != context.fonts.rtl()
        {
            return Err(unsupported("mixed inline text flow"));
        }
        for kind in [
            crate::cascade::Generated::Before,
            crate::cascade::Generated::After,
        ] {
            let generated = self.cascade.resolve(
                node,
                &Declarations::default(),
                Some(kind),
                self.containers,
                Some(self.controls),
                self.work,
            )?;
            if !matches!(
                generated.value("content").0.as_str(),
                "" | "none" | "normal" | "initial" | "unset"
            ) {
                return Err(unsupported("generated content in inline text"));
            }
        }
        let padding = horizontal_padding(&declarations, &computed.fonts, self.work)?;
        let start = source.start_inline(padding.start, &computed);
        if !self.inline_source(node, depth, &inherited, &computed, source, folded)? {
            return Ok(false);
        }
        source.end_inline(start, padding.end, &computed)?;
        source.record_inline(start, source.text.len(), &computed);
        folded.push(node.id);
        Ok(true)
    }
}

fn horizontal_padding(
    declarations: &Declarations,
    fonts: &crate::fonts::Context,
    work: &mut super::Work<'_>,
) -> Result<taffy::Line<taffy::LengthPercentage>> {
    let mut padding = taffy::Line {
        start: taffy::LengthPercentage::length(0.0),
        end: taffy::LengthPercentage::length(0.0),
    };
    for (name, value, _) in super::logical::entries(declarations, fonts.rtl()) {
        let slot = match name {
            "padding-left" => &mut padding.start,
            "padding-right" => &mut padding.end,
            _ => continue,
        };
        *slot = super::lengths::value(name, super::defaulted(name, value), fonts, work)?
            .parse()
            .map_err(|_error| unsupported("inline padding"))?;
    }
    Ok(padding)
}

fn inert(name: &str, value: &str) -> bool {
    name == "display"
        || name.starts_with("font-")
        || name.starts_with("text-")
        || name == "line-height"
        || name == "letter-spacing"
        || name == "vertical-align" && super::inline::baseline(value)
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
