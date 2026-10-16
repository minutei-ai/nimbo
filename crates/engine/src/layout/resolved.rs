//! CSSOM used box values come from the same native layout as geometry.
use dom_query::{Document, NodeRef};
use taffy::BoxSizing;

use super::{Sources, Work, layout_error, logical, scene, unsupported};
use crate::{MediaEnvironment, Result};

pub(crate) fn property(name: &str) -> bool {
    matches!(logical::group(name), Some("size" | "margin" | "padding"))
}

pub(crate) struct BoxValues {
    width: f32,
    height: f32,
    margin: [f32; 4],
    padding: [f32; 4],
    rtl: bool,
    content_basis: [f64; 2],
    padding_basis: [f64; 2],
    scroll_basis: [f64; 2],
    offsets: [f64; 4],
}

impl BoxValues {
    pub(crate) fn inset_basis(&self, position: &str, index: usize) -> f64 {
        let basis = match position {
            "absolute" | "fixed" => self.padding_basis,
            "sticky" => self.scroll_basis,
            _ => self.content_basis,
        };
        if index.is_multiple_of(2) {
            basis[1]
        } else {
            basis[0]
        }
    }
    pub(crate) fn inset_offset(&self, index: usize) -> Result<f64> {
        self.offsets
            .get(index)
            .copied()
            .ok_or_else(|| unsupported("inset side"))
    }
    pub(crate) fn value(&self, name: &str) -> Result<String> {
        let value = match logical::physical_in(name, self.rtl) {
            "width" => self.width,
            "height" => self.height,
            "margin-top" => self.margin[0],
            "margin-right" => self.margin[1],
            "margin-bottom" => self.margin[2],
            "margin-left" => self.margin[3],
            "padding-top" => self.padding[0],
            "padding-right" => self.padding[1],
            "padding-bottom" => self.padding[2],
            "padding-left" => self.padding[3],
            _ => return Err(unsupported("resolved box property")),
        };
        crate::fonts::pixels(f64::from(value))
    }
}

pub(crate) fn resolve(
    document: &Document,
    target: NodeRef<'_>,
    sources: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<BoxValues> {
    scene(document, sources, media, work, |tree| {
        let id = tree
            .ids
            .get(&target.id)
            .ok_or_else(|| unsupported("resolved style without box"))?;
        let layout = tree
            .boxes
            .layout(*id)
            .map_err(|error| layout_error(&error))?;
        let style = tree
            .boxes
            .style(*id)
            .map_err(|error| layout_error(&error))?;
        let size = if style.box_sizing == BoxSizing::BorderBox {
            layout.size
        } else {
            layout.content_box_size()
        };
        let mut content_basis = [f64::from(media.width), f64::from(media.height)];
        let mut padding_basis = content_basis;
        let mut offsets = [0.0; 4];
        let parent = std::iter::successors(tree.boxes.containing_block(*id), |parent| {
            tree.boxes.layout_parent(*parent)
        })
        .find(|parent| tree.box_nodes.contains_key(parent));
        if let Some(parent) = parent {
            let parent_layout = tree
                .boxes
                .layout(parent)
                .map_err(|error| layout_error(&error))?;
            let content = parent_layout.content_box_size();
            content_basis = [f64::from(content.width), f64::from(content.height)];
            padding_basis = [
                f64::from(
                    parent_layout.size.width
                        - parent_layout.border.left
                        - parent_layout.border.right
                        - parent_layout.scrollbar_size.width,
                ),
                f64::from(
                    parent_layout.size.height
                        - parent_layout.border.top
                        - parent_layout.border.bottom
                        - parent_layout.scrollbar_size.height,
                ),
            ];
            offsets = [
                f64::from(layout.location.y - parent_layout.border.top - layout.margin.top),
                padding_basis[0]
                    - f64::from(
                        layout.location.x - parent_layout.border.left
                            + layout.size.width
                            + layout.margin.right,
                    ),
                padding_basis[1]
                    - f64::from(
                        layout.location.y - parent_layout.border.top
                            + layout.size.height
                            + layout.margin.bottom,
                    ),
                f64::from(layout.location.x - parent_layout.border.left - layout.margin.left),
            ];
        }
        let scroll_basis = scroll_basis(tree, *id, media)?;
        Ok(BoxValues {
            width: size.width.max(0.0),
            height: size.height.max(0.0),
            margin: [
                layout.margin.top,
                layout.margin.right,
                layout.margin.bottom,
                layout.margin.left,
            ],
            padding: [
                layout.padding.top,
                layout.padding.right,
                layout.padding.bottom,
                layout.padding.left,
            ],
            rtl: style.direction == taffy::Direction::Rtl,
            content_basis,
            padding_basis,
            scroll_basis,
            offsets,
        })
    })
}

fn scroll_basis(
    tree: &super::Tree<'_, '_>,
    id: taffy::NodeId,
    media: &MediaEnvironment,
) -> Result<[f64; 2]> {
    let mut scroll_basis = [f64::from(media.width), f64::from(media.height)];
    let mut ancestor = tree.sticky.get(&id).and_then(|_| tree.boxes.parent(id));
    while let Some(parent) = ancestor {
        let style = tree
            .boxes
            .style(parent)
            .map_err(|error| layout_error(&error))?;
        if style.overflow.x != taffy::Overflow::Visible
            || style.overflow.y != taffy::Overflow::Visible
        {
            let layout = tree
                .boxes
                .layout(parent)
                .map_err(|error| layout_error(&error))?;
            let content = layout.content_box_size();
            scroll_basis = [f64::from(content.width), f64::from(content.height)];
            break;
        }
        ancestor = tree.boxes.parent(parent);
    }
    Ok(scroll_basis)
}
