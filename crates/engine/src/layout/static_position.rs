//! Native static positions across containing blocks with size-independent alignment.
use super::{Tree, layout_error, unsupported};
use crate::Result;
use taffy::{
    Point,
    prelude::*,
    style::{ExpandedDimension, ExpandedLengthPercentageAuto},
};

fn static_axes(style: &Style) -> (bool, bool) {
    (
        style.inset.left.is_auto() && style.inset.right.is_auto(),
        style.inset.top.is_auto() && style.inset.bottom.is_auto(),
    )
}
fn fixed_axis(size: Dimension, min: LengthPercentageAuto, max: LengthPercentageAuto) -> bool {
    matches!(size.expand(), ExpandedDimension::Length(_))
        && [min, max].iter().all(|value| {
            matches!(
                value.expand(),
                ExpandedLengthPercentageAuto::Auto | ExpandedLengthPercentageAuto::Length(_)
            )
        })
}
fn independent_axis(parent: &Style, child: &Style, horizontal: bool) -> bool {
    if matches!(parent.display, Display::Block | Display::FlowRoot) {
        return true;
    }
    if parent.display != Display::Flex
        || matches!(
            parent.flex_direction,
            FlexDirection::RowReverse | FlexDirection::ColumnReverse
        )
    {
        return false;
    }
    if horizontal == (parent.flex_direction == FlexDirection::Row) {
        parent.justify_content.is_none_or(|value| {
            matches!(
                value,
                JustifyContent::START | JustifyContent::FLEX_START | JustifyContent::STRETCH
            )
        })
    } else {
        child.align_self.or(parent.align_items).is_none_or(|value| {
            matches!(
                value,
                AlignItems::START
                    | AlignItems::FLEX_START
                    | AlignItems::SELF_START
                    | AlignItems::STRETCH
            )
        })
    }
}

struct Static {
    id: NodeId,
    parent: NodeId,
    old: NodeId,
    before: Option<NodeId>,
    x: bool,
    y: bool,
    measure: bool,
    style: Style,
}
impl Tree<'_, '_> {
    fn static_positions(&self, viewport: Option<NodeId>) -> Result<Vec<Static>> {
        let mut pending = Vec::new();
        for (id, containing) in &self.out_of_flow {
            let parent = containing
                .and_then(|node| self.ids.get(&node).copied())
                .or(viewport)
                .ok_or_else(|| unsupported("missing positioning containing block"))?;
            let style = self
                .boxes
                .style(*id)
                .map_err(|error| layout_error(&error))?;
            let (x, y) = static_axes(style);
            if self.boxes.parent(*id) == Some(parent) || !(x || y) {
                continue;
            }
            let old = self
                .boxes
                .parent(*id)
                .ok_or_else(|| unsupported("missing static position parent"))?;
            let old_style = self
                .boxes
                .style(old)
                .map_err(|error| layout_error(&error))?;
            if self
                .box_nodes
                .get(id)
                .is_some_and(|node| self.fixed.contains(node))
            {
                return Err(unsupported(
                    "fixed static position across containing blocks",
                ));
            }
            let measure = (x
                && !fixed_axis(style.size.width, style.min_size.width, style.max_size.width)
                && !independent_axis(old_style, style, true))
                || (y
                    && !fixed_axis(
                        style.size.height,
                        style.min_size.height,
                        style.max_size.height,
                    )
                    && !independent_axis(old_style, style, false))
                || [
                    style.margin.left,
                    style.margin.right,
                    style.margin.top,
                    style.margin.bottom,
                ]
                .iter()
                .any(|value| matches!(value.expand(), ExpandedLengthPercentageAuto::Percent(_)));
            pending.push(Static {
                id: *id,
                parent,
                old,
                before: self.static_anchor(old, *id)?,
                x,
                y,
                measure,
                style: style.clone(),
            });
        }
        Ok(pending)
    }
    pub(super) fn prepare_static_positions(
        &mut self,
        root: NodeId,
        viewport: Option<NodeId>,
        width: f32,
        height: f32,
    ) -> Result<()> {
        let pending = self.static_positions(viewport)?;
        if pending.is_empty() {
            return Ok(());
        }
        let root = viewport.unwrap_or(root);
        if pending.iter().any(|item| item.measure) {
            self.measure_static_sizes(root, viewport, width, height, &pending)?;
        } else {
            self.compute_layout(root, width, height)?;
        }
        // Capture every position before reparenting any ancestor in this batch.
        let positioned = pending
            .iter()
            .map(|item| {
                self.static_style(item)
                    .map(|style| (item.id, item.parent, style))
            })
            .collect::<Result<Vec<_>>>()?;
        for (id, parent, style) in positioned {
            self.reparent_static(id, parent)?;
            self.boxes
                .set_style(id, style)
                .map_err(|error| layout_error(&error))?;
        }
        Ok(())
    }
    fn measure_static_sizes(
        &mut self,
        root: NodeId,
        viewport: Option<NodeId>,
        width: f32,
        height: f32,
        pending: &[Static],
    ) -> Result<()> {
        for (id, containing) in self.out_of_flow.clone() {
            let parent = containing
                .and_then(|node| self.ids.get(&node).copied())
                .or(viewport)
                .ok_or_else(|| unsupported("missing positioning containing block"))?;
            self.reparent_static(id, parent)?;
        }
        // Resolve intrinsic/percentage sizes against their real containing box.
        self.compute_layout(root, width, height)?;
        for item in pending {
            if item.measure {
                let layout = self
                    .boxes
                    .layout(item.id)
                    .map_err(|error| layout_error(&error))?;
                let mut style = item.style.clone();
                style.box_sizing = BoxSizing::BorderBox;
                style.size = layout.size.map(Dimension::length);
                style.min_size = Size::auto();
                style.max_size = Size::auto();
                style.aspect_ratio = None;
                style.margin = layout.margin.map(LengthPercentageAuto::length);
                self.boxes
                    .set_style(item.id, style)
                    .map_err(|error| layout_error(&error))?;
            }
            self.restore_static(item)?;
        }
        // Place a box of that used size in its original formatting context.
        self.compute_layout(root, width, height)
    }
    fn static_anchor(&self, parent: NodeId, id: NodeId) -> Result<Option<NodeId>> {
        let children = self
            .boxes
            .children(parent)
            .map_err(|error| layout_error(&error))?;
        for child in children
            .into_iter()
            .skip_while(|child| *child != id)
            .skip(1)
        {
            if self
                .boxes
                .style(child)
                .map_err(|error| layout_error(&error))?
                .position
                != Position::Absolute
            {
                return Ok(Some(child));
            }
        }
        Ok(None)
    }
    fn restore_static(&mut self, item: &Static) -> Result<()> {
        self.work.charge()?;
        if let Some(parent) = self.boxes.parent(item.id) {
            self.boxes
                .remove_child(parent, item.id)
                .map_err(|error| layout_error(&error))?;
        }
        let children = self
            .boxes
            .children(item.old)
            .map_err(|error| layout_error(&error))?;
        let index = item
            .before
            .and_then(|before| children.iter().position(|id| *id == before))
            .unwrap_or(children.len());
        self.boxes
            .insert_child_at_index(item.old, index, item.id)
            .map_err(|error| layout_error(&error))
    }
    fn reparent_static(&mut self, id: NodeId, parent: NodeId) -> Result<()> {
        self.work.charge()?;
        if self.boxes.parent(id) == Some(parent) {
            return Ok(());
        }
        if let Some(old) = self.boxes.parent(id) {
            self.boxes
                .remove_child(old, id)
                .map_err(|error| layout_error(&error))?;
        }
        self.boxes
            .add_child(parent, id)
            .map_err(|error| layout_error(&error))
    }
    fn static_style(&mut self, item: &Static) -> Result<Style> {
        let origin = self.layout_origin(item.id)?;
        let containing = self.layout_origin(item.parent)?;
        let border = self
            .boxes
            .layout(item.parent)
            .map_err(|error| layout_error(&error))?
            .border;
        let margin = self
            .boxes
            .layout(item.id)
            .map_err(|error| layout_error(&error))?
            .margin;
        let mut style = item.style.clone();
        if item.x {
            style.inset.left =
                LengthPercentageAuto::length(origin.x - containing.x - border.left - margin.left);
        }
        if item.y {
            style.inset.top =
                LengthPercentageAuto::length(origin.y - containing.y - border.top - margin.top);
        }
        Ok(style)
    }
    fn layout_origin(&mut self, id: NodeId) -> Result<Point<f32>> {
        let mut position = Point::ZERO;
        let mut next = Some(id);
        while let Some(id) = next {
            self.work.charge()?;
            let layout = self
                .boxes
                .layout(id)
                .map_err(|error| layout_error(&error))?;
            position.x += layout.location.x;
            position.y += layout.location.y;
            next = self.boxes.parent(id);
        }
        Ok(position)
    }
}
