//! Resolve all percentage padding sides against containing-block width.
use taffy::{Position, prelude::*, style::ExpandedLengthPercentage};

use super::{Tree, layout_error, unsupported};
use crate::{Error, Result};

impl Tree<'_, '_> {
    pub(super) fn remember_padding(&mut self, id: NodeId) -> Result<()> {
        let padding = self
            .boxes
            .style(id)
            .map_err(|error| layout_error(&error))?
            .padding;
        if [padding.top, padding.right, padding.bottom, padding.left]
            .iter()
            .any(|value| matches!(value.expand(), ExpandedLengthPercentage::Percent(_)))
        {
            self.percentage_padding.push((id, padding));
        }
        Ok(())
    }

    pub(super) fn compute_layout(&mut self, root: NodeId, width: f32, height: f32) -> Result<()> {
        for _round in 0..=32 {
            self.boxes
                .compute_layout_with_measure(
                    root,
                    Size {
                        width: AvailableSpace::Definite(width),
                        height: AvailableSpace::Definite(height),
                    },
                    |inputs, _, context, style| {
                        taffy::compute::compute_leaf_layout(
                            inputs,
                            style,
                            |_, _| 0.0,
                            |known, available| {
                                context
                                    .as_ref()
                                    .map_or(Size::ZERO, |svg| svg.measure(known, available))
                            },
                        )
                    },
                )
                .map_err(|error| layout_error(&error))?;
            self.text_budget.check()?;
            let mut changed = false;
            for (id, original) in &self.percentage_padding {
                self.work.charge()?;
                let mut style = self
                    .boxes
                    .style(*id)
                    .map_err(|error| layout_error(&error))?
                    .clone();
                let basis = if let Some(parent) = self.boxes.parent(*id) {
                    let parent = self
                        .boxes
                        .layout(parent)
                        .map_err(|error| layout_error(&error))?;
                    if style.position == Position::Absolute {
                        parent.size.width - parent.border.left - parent.border.right
                    } else {
                        parent.content_box_width()
                    }
                } else {
                    width
                };
                if !basis.is_finite() || basis < 0.0 {
                    return Err(unsupported("percentage padding basis"));
                }
                let padding = original.map(|value| {
                    LengthPercentage::length(match value.expand() {
                        ExpandedLengthPercentage::Length(value) => value,
                        ExpandedLengthPercentage::Percent(value) => value * basis,
                    })
                });
                if style.padding != padding {
                    style.padding = padding;
                    self.boxes
                        .set_style(*id, style)
                        .map_err(|error| layout_error(&error))?;
                    changed = true;
                }
            }
            if !changed {
                return Ok(());
            }
        }
        Err(Error::Limit("percentage padding layout passes"))
    }
}
