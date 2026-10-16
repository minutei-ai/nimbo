use super::{native_tree::Boxes, text, unsupported};
use crate::Result;
use num_traits::ToPrimitive;
use taffy::{
    LayoutInput, LayoutOutput, LayoutPartialTree, Overflow, Point, RequestedAxis, RunMode,
    SizingMode, prelude::*, util::ResolveOrZero,
};

fn objects(
    run: &text::Run,
    tree: &mut Boxes,
    input: LayoutInput,
    known: Size<Option<f32>>,
    available: Size<AvailableSpace>,
) -> Result<Vec<text::Object>> {
    let basis = known.width.or(match available.width {
        AvailableSpace::Definite(value) => Some(value),
        _ => input.parent_size.width,
    });
    run.atoms
        .iter()
        .enumerate()
        .map(|(order, atom)| {
            let style = tree.get_core_container_style(atom.id);
            let margin = style.margin.resolve_or_zero(basis, |_, _| 0.0);
            let border = style.border.resolve_or_zero(basis, |_, _| 0.0);
            let padding = style.padding.resolve_or_zero(basis, |_, _| 0.0);
            let x = if style.direction == taffy::Direction::Rtl && !style.inset.right.is_auto() {
                -style.inset.right.resolve_or_zero(basis, |_, _| 0.0)
            } else if !style.inset.left.is_auto() {
                style.inset.left.resolve_or_zero(basis, |_, _| 0.0)
            } else {
                -style.inset.right.resolve_or_zero(basis, |_, _| 0.0)
            };
            let y = if style.inset.top.is_auto() {
                -style
                    .inset
                    .bottom
                    .resolve_or_zero(input.parent_size.height, |_, _| 0.0)
            } else {
                style
                    .inset
                    .top
                    .resolve_or_zero(input.parent_size.height, |_, _| 0.0)
            };
            let top = style.align_self == Some(AlignItems::FLEX_START);
            let scrollbar_size = Size {
                width: if style.overflow.y == Overflow::Scroll {
                    style.scrollbar_width
                } else {
                    0.0
                },
                height: if style.overflow.x == Overflow::Scroll {
                    style.scrollbar_width
                } else {
                    0.0
                },
            };
            let output = atom_layout(
                tree,
                atom.id,
                LayoutInput {
                    run_mode: input.run_mode,
                    sizing_mode: SizingMode::InherentSize,
                    axis: RequestedAxis::Both,
                    known_dimensions: Size::NONE,
                    known_dimensions_are_definite: Size {
                        width: true,
                        height: true,
                    },
                    parent_size: Size {
                        width: basis,
                        height: input.parent_size.height,
                    },
                    available_space: Size {
                        width: known
                            .width
                            .map_or(available.width, AvailableSpace::Definite),
                        height: available.height,
                    },
                    vertical_margins_are_collapsible: Line::FALSE,
                },
            );
            let baseline = output
                .baselines
                .first
                .unwrap_or(output.size.height + margin.bottom)
                + margin.top;
            Ok(text::Object {
                index: atom.index,
                baseline: f64::from(baseline),
                top,
                relative: Point { x, y },
                layout: Layout {
                    order: order
                        .to_u32()
                        .ok_or_else(|| unsupported("inline item order"))?,
                    location: Point::ZERO,
                    size: output.size,
                    margin,
                    padding,
                    border,
                    scrollbar_size,
                    scrollable_overflow_rect: output.scrollable_overflow_rect,
                },
            })
        })
        .collect()
}

fn atom_layout(tree: &mut Boxes, id: NodeId, mut input: LayoutInput) -> LayoutOutput {
    let style = tree.get_core_container_style(id);
    if !style.size.width.is_auto() || style.item_is_replaced {
        return tree.compute_child_layout(id, input);
    }
    let AvailableSpace::Definite(available) = input.available_space.width else {
        return tree.compute_child_layout(id, input);
    };
    let available = (available
        - style
            .margin
            .resolve_or_zero(input.parent_size.width, |_, _| 0.0)
            .horizontal_axis_sum())
    .max(0.0);
    let maximum = tree.compute_child_layout(
        id,
        LayoutInput {
            run_mode: RunMode::ComputeSize,
            available_space: Size::MAX_CONTENT,
            ..input
        },
    );
    let width = if maximum.size.width <= available {
        maximum.size.width
    } else {
        let minimum = tree.compute_child_layout(
            id,
            LayoutInput {
                run_mode: RunMode::ComputeSize,
                available_space: Size {
                    width: AvailableSpace::MinContent,
                    height: AvailableSpace::MaxContent,
                },
                ..input
            },
        );
        minimum.size.width.max(available.min(maximum.size.width))
    };
    input.known_dimensions.width = Some(width);
    tree.compute_child_layout(id, input)
}

pub(super) fn layout(
    run: &text::Run,
    tree: &mut Boxes,
    id: NodeId,
    input: LayoutInput,
) -> LayoutOutput {
    let style = tree.get_core_container_style(id).clone();
    let mut frames = Vec::new();
    let (mut output, measured) = run.leaf_layout(input, &style, |known, available| {
        match objects(run, tree, input, known, available) {
            Ok(objects) => {
                frames = objects;
                run.measured(known, available, &frames)
            }
            Err(error) => run.failed(error),
        }
    });
    if input.run_mode != RunMode::PerformLayout {
        return output;
    }
    let result = position(run, tree, id, &measured, &frames, &mut output);
    if let Err(error) = result {
        run.record(error);
    }
    output
}

fn position(
    run: &text::Run,
    tree: &mut Boxes,
    id: NodeId,
    measured: &text::Measured,
    frames: &[text::Object],
    output: &mut LayoutOutput,
) -> Result<()> {
    let width = f64::from(output.size.width);
    for (atom, frame) in run.atoms.iter().zip(frames) {
        let line = measured
            .lines
            .get(
                measured
                    .lines
                    .partition_point(|line| line.end <= atom.index),
            )
            .filter(|line| atom.index >= line.start && atom.index < line.end)
            .ok_or_else(|| unsupported("inline object line"))?;
        let prefix = run.range_width(line.start, atom.index, None, frames)?;
        let extent = f64::from(frame.layout.size.width + frame.layout.margin.horizontal_axis_sum());
        let x = if run.rtl {
            line.width - prefix - extent
        } else {
            prefix
        };
        let x = run.line_offset(line.width, width) + x + f64::from(frame.layout.margin.left);
        let y = if frame.top {
            line.y + f64::from(frame.layout.margin.top)
        } else {
            line.y + line.baseline - frame.baseline + f64::from(frame.layout.margin.top)
        };
        let number = |value: f64| {
            value
                .to_f32()
                .filter(|value| value.is_finite())
                .ok_or_else(|| unsupported("inline position range"))
        };
        let layout = Layout {
            location: Point {
                x: number(x + f64::from(frame.relative.x))?,
                y: number(y + f64::from(frame.relative.y))?,
            },
            ..frame.layout
        };
        let style = tree.get_core_container_style(atom.id);
        let clipped = style.overflow.x.is_scroll_container()
            || style.overflow.y.is_scroll_container()
            || style.contain.contains_scrollable_overflow();
        let overflow = Rect {
            left: if !clipped && style.overflow.x == Overflow::Visible {
                layout.scrollable_overflow_rect.left.min(0.0)
            } else {
                0.0
            },
            right: if !clipped && style.overflow.x == Overflow::Visible {
                layout.size.width.max(layout.scrollable_overflow_rect.right)
            } else {
                layout.size.width
            },
            top: if !clipped && style.overflow.y == Overflow::Visible {
                layout.scrollable_overflow_rect.top.min(0.0)
            } else {
                0.0
            },
            bottom: if !clipped && style.overflow.y == Overflow::Visible {
                layout
                    .size
                    .height
                    .max(layout.scrollable_overflow_rect.bottom)
            } else {
                layout.size.height
            },
        };
        output.scrollable_overflow_rect.left = output
            .scrollable_overflow_rect
            .left
            .min(layout.location.x + overflow.left);
        output.scrollable_overflow_rect.top = output
            .scrollable_overflow_rect
            .top
            .min(layout.location.y + overflow.top);
        output.scrollable_overflow_rect.right = output
            .scrollable_overflow_rect
            .right
            .max(layout.location.x + overflow.right);
        output.scrollable_overflow_rect.bottom = output
            .scrollable_overflow_rect
            .bottom
            .max(layout.location.y + overflow.bottom);
        tree.set_unrounded_layout(atom.id, &layout);
    }
    for (node, bounds) in run.fragments(measured, frames, width)? {
        tree.fragments.insert(node, (id, bounds));
    }
    Ok(())
}
