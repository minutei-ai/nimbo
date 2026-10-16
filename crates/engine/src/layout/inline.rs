//! Native atomic inline boxes arranged in baseline-aligned line boxes.
use super::{BoxContext, Tree, layout_error, text, unsupported};
use crate::{Result, styles::Declarations};
use lightningcss::{
    properties::font::{VerticalAlign, VerticalAlignKeyword},
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
};
use num_traits::ToPrimitive;
use taffy::{TaffyError, prelude::*};

pub(super) fn baseline(value: &str) -> bool {
    matches!(value, "" | "baseline" | "initial" | "unset" | "revert")
}

pub(super) fn atomic_style(
    style: &mut Style,
    display: &crate::display::Computed,
    declarations: &Declarations,
) -> Result<Option<VerticalAlign>> {
    if !display.inline_atomic() {
        return Ok(None);
    }
    let value = declarations.value("vertical-align").0;
    let vertical = match value.as_str() {
        value if baseline(value) => None,
        value => Some(
            VerticalAlign::parse_string(value)
                .map_err(|_error| unsupported("atomic inline vertical alignment"))?,
        ),
    };
    style.align_self = match vertical {
        None
        | Some(VerticalAlign::Keyword(VerticalAlignKeyword::Middle) | VerticalAlign::Length(_)) => {
            None
        }
        Some(VerticalAlign::Keyword(VerticalAlignKeyword::Top)) => Some(AlignItems::FLEX_START),
        _ => {
            return Err(unsupported(&format!(
                "atomic inline vertical alignment ({value})"
            )));
        }
    };
    style.flex_grow = 0.0;
    style.flex_basis = Dimension::AUTO;
    style.flex_shrink = if style.size.width.is_auto() { 1.0 } else { 0.0 };
    style.margin = style.margin.map(|value| {
        if value.is_auto() {
            LengthPercentageAuto::length(0.0)
        } else {
            value
        }
    });
    Ok(vertical)
}

impl Tree<'_, '_> {
    pub(super) fn remember_inline_item(
        &mut self,
        id: NodeId,
        context: &BoxContext,
        parent: &BoxContext,
        vertical: Option<VerticalAlign>,
    ) -> Result<()> {
        self.orders.insert(id, context.order);
        if context.display.inline_atomic() {
            self.inline_atoms.insert(id);
            self.boxes
                .inline_align(id, super::native_tree::InlineAlignment::Baseline);
            match vertical {
                Some(VerticalAlign::Keyword(VerticalAlignKeyword::Middle)) => {
                    let height = parent.typography.x_height(
                        &parent.fonts,
                        &parent.family,
                        &self.fonts.borrow(),
                        self.work,
                    )?;
                    self.boxes
                        .inline_align(id, super::native_tree::InlineAlignment::Middle(height));
                }
                Some(VerticalAlign::Length(value)) => {
                    let css = value
                        .to_css_string(PrinterOptions::default())
                        .map_err(|error| crate::Error::Dom(error.to_string()))?;
                    let strut = text::Run::strut(
                        &context.typography,
                        context,
                        &self.fonts.borrow(),
                        std::rc::Rc::clone(&self.text_budget),
                    )?;
                    let offset = crate::position_value::Value::from_css(
                        &css,
                        &context.fonts,
                        self.work,
                        false,
                    )?
                    .resolve(strut.line_height())?;
                    let offset = offset
                        .to_f32()
                        .filter(|value| value.is_finite())
                        .ok_or_else(|| unsupported("atomic inline vertical alignment range"))?;
                    self.boxes
                        .inline_align(id, super::native_tree::InlineAlignment::Offset(offset));
                }
                _ => {}
            }
        }
        Ok(())
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
        if !matches!(style.display, Display::Block | Display::FlowRoot)
            || children.iter().any(|id| !self.inline_atoms.contains(id))
        {
            return Err(unsupported("mixed atomic inline formatting"));
        }
        let multiple = children.len() > 1;
        if multiple {
            let mut groups = Vec::new();
            for atom in children.iter().copied() {
                let strut = self.inline_strut(context)?;
                self.visit(0)?;
                let alignment = self
                    .boxes
                    .style(atom)
                    .map_err(|error| layout_error(&error))?
                    .align_self;
                let group = self
                    .boxes
                    .new_with_children(
                        Style {
                            display: Display::Flex,
                            align_items: Some(alignment.unwrap_or(AlignItems::BASELINE)),
                            align_self: alignment,
                            flex_grow: 0.0,
                            flex_shrink: 1.0,
                            ..Style::default()
                        },
                        &[strut, atom],
                    )
                    .map_err(|error| layout_error(&error))?;
                groups.push(group);
            }
            *children = groups;
        } else {
            children.insert(0, self.inline_strut(context)?);
        }
        style.display = Display::Flex;
        style.flex_direction = FlexDirection::Row;
        style.flex_wrap = if multiple {
            FlexWrap::Wrap
        } else {
            FlexWrap::NoWrap
        };
        style.align_content = Some(AlignContent::START);
        style.align_items = Some(AlignItems::BASELINE);
        style.justify_content = Some(context.typography.justify(context.fonts.rtl())?);
        style.gap = Size::ZERO.map(LengthPercentage::length);
        Ok(())
    }
    fn inline_strut(&mut self, context: &BoxContext) -> Result<NodeId> {
        self.visit(0)?;
        let run = text::Run::strut(
            &context.typography,
            context,
            &self.fonts.borrow(),
            std::rc::Rc::clone(&self.text_budget),
        )?;
        self.leaf(
            Style {
                display: Display::Block,
                flex_shrink: 0.0,
                ..Style::default()
            },
            text::Intrinsic::Text(run),
        )
        .map_err(|error| layout_error(&error))
    }
}
