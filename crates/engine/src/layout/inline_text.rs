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
        if !crate::html_boxes::text_inline(node) || !display.inline_flow() {
            return Ok(false);
        }
        self.visit(depth)?;
        let computed = self.inline_context(node, &declarations, context, display)?;
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
    fn inline_context(
        &mut self,
        node: NodeRef<'_>,
        declarations: &Declarations,
        context: &BoxContext,
        display: crate::display::Computed,
    ) -> Result<BoxContext> {
        let static_position = matches!(
            declarations.value("position").0.as_str(),
            "" | "static" | "initial" | "unset" | "revert"
        );
        if let Some((name, value, _)) =
            declarations
                .layout_entries()
                .find(|(name, value, deferred)| {
                    *deferred
                        || !(inert(name, value)
                            || static_position
                                && (*name == "position"
                                    || super::logical::group(name) == Some("inset"))
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
            declarations,
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
        Ok(computed)
    }
    pub(super) fn mixed_inline_child(
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
        if display.inline_atomic() {
            let mut items = Vec::new();
            self.build(
                node,
                depth,
                variables,
                super::FormattingContext {
                    display: taffy::Display::Block,
                    context,
                },
                context,
                &mut items,
            )?;
            for id in items {
                source.append_atom(id, context)?;
            }
            return Ok(true);
        }
        if !crate::html_boxes::text_inline(node) || !display.inline_flow() {
            return Ok(false);
        }
        self.visit(depth)?;
        let computed = self.inline_context(node, &declarations, context, display)?;
        let padding = horizontal_padding(&declarations, &computed.fonts, self.work)?;
        let start = source.start_inline(padding.start, &computed);
        for child in node.children_it(false) {
            if !self.mixed_inline_child(
                child,
                depth.saturating_add(1),
                &inherited,
                &computed,
                source,
                folded,
            )? {
                return Err(unsupported("block inside inline wrapper"));
            }
        }
        source.end_inline(start, padding.end, &computed)?;
        source.boxes.push(super::text_source::Span {
            start,
            end: source.text.len(),
            metrics: super::text::Metrics::new(&computed),
            node: Some(node.id),
        });
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
        || matches!(
            super::logical::group(name),
            Some("size" | "min-size" | "max-size")
        )
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
