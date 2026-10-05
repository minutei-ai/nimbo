//! A bounded native line box containing exactly one atomic inline flex box.
use super::{BoxContext, Tree, layout_error, text, unsupported};
use crate::{Result, styles::Declarations};
use taffy::{TaffyError, prelude::*};

pub(super) fn atomic_style(
    style: &mut Style,
    display: &crate::display::Computed,
    declarations: &Declarations,
) -> Result<()> {
    if !display.inline_atomic() {
        return Ok(());
    }
    let (alignment, _) = declarations.value("vertical-align");
    if !matches!(
        alignment.as_str(),
        "" | "baseline" | "initial" | "unset" | "revert"
    ) {
        return Err(unsupported("atomic inline vertical alignment"));
    }
    style.flex_grow = 0.0;
    style.flex_basis = Dimension::AUTO;
    style.flex_shrink = if style.size.width.is_auto() { 1.0 } else { 0.0 };
    style.align_self = None;
    style.margin = style.margin.map(|value| {
        if value.is_auto() {
            LengthPercentageAuto::length(0.0)
        } else {
            value
        }
    });
    Ok(())
}

impl Tree<'_, '_> {
    pub(super) fn remember_inline_item(&mut self, id: NodeId, context: &BoxContext) {
        self.orders.insert(id, context.order);
        if context.display.inline_atomic() {
            self.inline_atoms.insert(id);
        }
    }
    pub(super) fn leaf(
        &mut self,
        style: Style,
        intrinsic: text::Intrinsic,
    ) -> std::result::Result<NodeId, TaffyError> {
        self.boxes.new_leaf_with_context(style, intrinsic)
    }
    pub(super) fn inline_flow(
        &mut self,
        style: &mut Style,
        children: &mut Vec<NodeId>,
        context: &BoxContext,
    ) -> Result<()> {
        if !children.iter().any(|id| self.inline_atoms.contains(id)) {
            return Ok(());
        }
        if style.display != Display::Block || children.len() != 1 {
            return Err(unsupported("mixed atomic inline formatting"));
        }
        self.work.charge()?;
        let run = text::Run::strut(
            &context.typography,
            context,
            &self.fonts.borrow(),
            std::rc::Rc::clone(&self.text_budget),
        )?;
        let strut = self
            .leaf(
                Style {
                    display: Display::Block,
                    flex_shrink: 0.0,
                    ..Style::default()
                },
                text::Intrinsic::Text(run),
            )
            .map_err(|error| layout_error(&error))?;
        children.insert(0, strut);
        style.display = Display::Flex;
        style.flex_direction = FlexDirection::Row;
        style.flex_wrap = FlexWrap::NoWrap;
        style.align_items = Some(AlignItems::BASELINE);
        style.justify_content = Some(JustifyContent::START);
        style.gap = Size::ZERO.map(LengthPercentage::length);
        Ok(())
    }
}
