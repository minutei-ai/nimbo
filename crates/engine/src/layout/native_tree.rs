//! Native sizing containment layered over public Taffy layout algorithms.
use super::text::Intrinsic;
use std::{
    collections::{HashMap, HashSet},
    ops::{Deref, DerefMut},
};
use taffy::util::ResolveOrZero;
use taffy::{
    BlockContext, Cache, CacheTree, LayoutBlockContainer, LayoutFlexboxContainer,
    LayoutGridContainer, LayoutInput, LayoutOutput, LayoutPartialTree, Overflow, RequestedAxis,
    RunMode, TraversePartialTree, TraverseTree, prelude::*,
};

pub(super) enum InlineAlignment {
    Baseline,
    Middle(f32),
    Offset(f32),
}

impl InlineAlignment {
    fn apply(&self, output: &mut LayoutOutput, style: &Style, parent_width: Option<f32>) {
        let margin = style.margin.resolve_or_zero(parent_width, |_, _| 0.0);
        let fallback = output.size.height + margin.bottom;
        let baselines = if style.display == Display::FlowRoot {
            let baseline = if style.overflow.y.is_scroll_container() {
                Some(fallback)
            } else {
                output.baselines.last
            };
            taffy::Baselines {
                first: baseline,
                last: baseline,
            }
        } else {
            output.baselines
        };
        let align = |baseline: Option<f32>| match self {
            Self::Baseline => baseline.unwrap_or(fallback),
            Self::Middle(x_height) => {
                (output.size.height + margin.bottom - margin.top + x_height) / 2.0
            }
            Self::Offset(value) => baseline.unwrap_or(fallback) + value,
        };
        output.baselines = taffy::Baselines {
            first: Some(align(baselines.first)),
            last: Some(align(baselines.last)),
        };
    }
}

pub(super) struct Boxes {
    tree: TaffyTree<Intrinsic>,
    pub(super) transformed: HashSet<NodeId>,
    hoisted: HashMap<NodeId, Vec<NodeId>>,
    containing_blocks: HashMap<NodeId, NodeId>,
    grid_info: HashMap<NodeId, taffy::DetailedLayoutInfo<String>>,
    layouts: HashMap<NodeId, Layout>,
    caches: HashMap<NodeId, Cache>,
    containment: HashMap<NodeId, u8>,
    pub(super) inline_alignment: HashMap<NodeId, InlineAlignment>,
    pub(super) flows: HashMap<NodeId, std::rc::Rc<super::text::Run>>,
    pub(super) fragments: HashMap<dom_query::NodeId, (NodeId, Vec<super::Bounds>)>,
    inline_flex_items: HashMap<NodeId, Style>,
    default_style: Style,
}
impl Boxes {
    pub(super) fn new() -> Self {
        Self {
            tree: TaffyTree::new(),
            transformed: HashSet::new(),
            hoisted: HashMap::new(),
            containing_blocks: HashMap::new(),
            grid_info: HashMap::new(),
            layouts: HashMap::new(),
            caches: HashMap::new(),
            containment: HashMap::new(),
            inline_alignment: HashMap::new(),
            flows: HashMap::new(),
            fragments: HashMap::new(),
            inline_flex_items: HashMap::new(),
            default_style: Style::default(),
        }
    }
    pub(super) fn get_core_container_style(&self, id: NodeId) -> &Style {
        self.tree.style(id).unwrap_or(&self.default_style)
    }
    pub(super) fn layout_parent(&self, id: NodeId) -> Option<NodeId> {
        self.containing_blocks
            .get(&id)
            .copied()
            .or_else(|| self.tree.parent(id))
    }
    pub(super) fn containing_block(&self, id: NodeId) -> Option<NodeId> {
        let parent = self.layout_parent(id)?;
        let position = self.get_core_container_style(id).position;
        if position.is_out_of_flow()
            && !self.transformed.contains(&parent)
            && (position == Position::Fixed
                || !self
                    .get_core_container_style(parent)
                    .position
                    .is_positioned())
        {
            return None;
        }
        Some(parent)
    }
    pub(super) fn layout_children(&self, id: NodeId) -> Vec<NodeId> {
        self.tree
            .child_ids(id)
            .filter(|child| !self.containing_blocks.contains_key(child))
            .chain(self.hoisted.get(&id).into_iter().flatten().copied())
            .collect()
    }
    fn container_style(&self, id: NodeId) -> super::container_style::ContainerStyle<'_> {
        super::container_style::ContainerStyle {
            style: self.get_core_container_style(id),
            transformed: self.transformed.contains(&id),
        }
    }
    pub(super) fn contain(&mut self, id: NodeId, axes: u8) {
        if axes > 0 {
            self.containment.insert(id, axes);
        }
    }
    pub(super) fn layout(&self, id: NodeId) -> Result<&Layout, taffy::TaffyError> {
        self.layouts
            .get(&id)
            .map_or_else(|| self.tree.layout(id), Ok)
    }
    pub(super) fn compute(&mut self, root: NodeId, space: Size<AvailableSpace>) {
        self.caches.clear();
        self.layouts.clear();
        self.fragments.clear();
        self.hoisted.clear();
        self.containing_blocks.clear();
        self.grid_info.clear();
        self.inline_flex_items = self
            .inline_alignment
            .keys()
            .filter_map(|id| {
                let style = self.get_core_container_style(*id);
                if !style.overflow.y.is_scroll_container() {
                    return None;
                }
                let mut item = style.clone();
                item.overflow.y = Overflow::Clip;
                Some((*id, item))
            })
            .collect();
        taffy::compute_root_layout(self, root, space);
    }
    fn dispatch(
        &mut self,
        id: NodeId,
        mut input: LayoutInput,
        block: Option<&mut BlockContext<'_>>,
    ) -> LayoutOutput {
        if input.run_mode == RunMode::PerformHiddenLayout {
            return taffy::compute_hidden_layout(self, id);
        }
        taffy::compute_cached_layout(self, id, input, |tree, id, original| {
            input = original;
            let axes = tree.containment.get(&id).copied().unwrap_or_default();
            if axes > 0 {
                // Size containment measures the contained axes as an empty box,
                // then lays out the real descendants at that resulting size.
                let empty = taffy::compute_leaf_layout(
                    input,
                    tree.get_core_container_style(id),
                    |_, _| 0.0,
                    |_, _| Size::ZERO,
                );
                if input.run_mode == RunMode::ComputeSize
                    && (axes == 3 || input.axis == RequestedAxis::Horizontal)
                {
                    return empty;
                }
                input.known_dimensions.width = Some(empty.size.width);
                if axes == 3 {
                    input.known_dimensions.height = Some(empty.size.height);
                }
            }
            let flow = tree.flows.get(&id).map(std::rc::Rc::clone);
            let mut output = if let Some(run) = flow {
                super::inline_flow::layout(&run, tree, id, input)
            } else {
                let style = tree.get_core_container_style(id);
                match (style.display, tree.child_count(id) > 0) {
                    (Display::None, _) => taffy::compute_hidden_layout(tree, id),
                    (Display::Block, true) => taffy::compute_block_layout(tree, id, input, block),
                    (Display::FlowRoot, true) => taffy::compute_block_layout(tree, id, input, None),
                    (Display::Flex, true) => taffy::compute_flexbox_layout(tree, id, input),
                    (Display::Grid, true) => taffy::compute_grid_layout(tree, id, input),
                    (_, false) => tree.tree.get_node_context(id).map_or_else(
                        || taffy::compute_leaf_layout(input, style, |_, _| 0.0, |_, _| Size::ZERO),
                        |intrinsic| intrinsic.layout(input, style),
                    ),
                }
            };
            if let Some(alignment) = tree.inline_alignment.get(&id) {
                alignment.apply(
                    &mut output,
                    tree.get_core_container_style(id),
                    input.parent_size.width,
                );
            }
            if input.run_mode == RunMode::PerformLayout {
                taffy::compute_oof_layout(tree, id, &mut output);
            }
            output
        })
    }
}
impl Deref for Boxes {
    type Target = TaffyTree<Intrinsic>;
    fn deref(&self) -> &Self::Target {
        &self.tree
    }
}
impl DerefMut for Boxes {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.tree
    }
}
impl TraversePartialTree for Boxes {
    type ChildIter<'a> = <TaffyTree<Intrinsic> as TraversePartialTree>::ChildIter<'a>;
    fn child_ids(&self, id: NodeId) -> Self::ChildIter<'_> {
        self.tree.child_ids(id)
    }
    fn child_count(&self, id: NodeId) -> usize {
        self.tree.child_count(id)
    }
    fn get_child_id(&self, id: NodeId, index: usize) -> NodeId {
        self.tree.get_child_id(id, index)
    }
}
impl TraverseTree for Boxes {}
impl LayoutPartialTree for Boxes {
    type CustomIdent = String;
    type CoreContainerStyle<'a> = super::container_style::ContainerStyle<'a>;
    fn get_core_container_style(&self, id: NodeId) -> Self::CoreContainerStyle<'_> {
        self.container_style(id)
    }
    fn set_unrounded_layout(&mut self, id: NodeId, layout: &Layout) {
        self.layouts.insert(id, *layout);
    }
    fn resolve_calc_value(&self, _value: *const (), _basis: f32) -> f32 {
        0.0
    }
    fn compute_child_layout(&mut self, id: NodeId, input: LayoutInput) -> LayoutOutput {
        self.dispatch(id, input, None)
    }
}
impl CacheTree for Boxes {
    fn cache_get(&mut self, id: NodeId, input: &LayoutInput) -> Option<LayoutOutput> {
        self.caches.get_mut(&id).and_then(|cache| cache.get(input))
    }
    fn cache_store(&mut self, id: NodeId, input: &LayoutInput, output: LayoutOutput) {
        self.caches.entry(id).or_default().store(input, output);
    }
    fn cache_clear(&mut self, id: NodeId) {
        self.caches.remove(&id);
    }
}
impl LayoutBlockContainer for Boxes {
    type BlockContainerStyle<'a> = &'a Style;
    type BlockItemStyle<'a> = &'a Style;
    fn get_block_container_style(&self, id: NodeId) -> &Style {
        self.get_core_container_style(id)
    }
    fn get_block_child_style(&self, id: NodeId) -> &Style {
        self.get_core_container_style(id)
    }
    fn compute_block_child_layout(
        &mut self,
        id: NodeId,
        input: LayoutInput,
        block: Option<&mut BlockContext<'_>>,
    ) -> LayoutOutput {
        self.dispatch(id, input, block)
    }
}
impl LayoutFlexboxContainer for Boxes {
    type FlexboxContainerStyle<'a> = &'a Style;
    type FlexboxItemStyle<'a> = &'a Style;
    fn get_flexbox_container_style(&self, id: NodeId) -> &Style {
        self.get_core_container_style(id)
    }
    fn get_flexbox_child_style(&self, id: NodeId) -> &Style {
        self.inline_flex_items
            .get(&id)
            .unwrap_or_else(|| self.get_core_container_style(id))
    }
}
impl LayoutGridContainer for Boxes {
    type GridContainerStyle<'a> = super::container_style::ContainerStyle<'a>;
    type GridItemStyle<'a> = &'a Style;
    fn get_grid_container_style(&self, id: NodeId) -> Self::GridContainerStyle<'_> {
        self.container_style(id)
    }
    fn set_detailed_grid_info(&mut self, id: NodeId, info: taffy::DetailedGridInfo<String>) {
        self.grid_info
            .insert(id, taffy::DetailedLayoutInfo::Grid(Box::new(info)));
    }
    fn get_grid_child_style(&self, id: NodeId) -> &Style {
        self.get_core_container_style(id)
    }
}

impl taffy::LayoutContainingBlock for Boxes {
    type OofItemStyle<'a> = &'a Style;
    fn get_oof_item_style(&self, id: NodeId) -> &Style {
        self.get_core_container_style(id)
    }
    fn clear_hoisted_children(&mut self, id: NodeId) {
        if let Some(children) = self.hoisted.remove(&id) {
            for child in children {
                self.containing_blocks.remove(&child);
            }
        }
    }
    fn add_hoisted_children(&mut self, id: NodeId, children: &[NodeId]) {
        self.hoisted
            .entry(id)
            .or_default()
            .extend_from_slice(children);
        for child in children {
            self.containing_blocks.insert(*child, id);
        }
    }
    fn get_detailed_layout_info(&self, id: NodeId) -> &taffy::DetailedLayoutInfo<String> {
        self.grid_info
            .get(&id)
            .unwrap_or(&taffy::DetailedLayoutInfo::None)
    }
}
