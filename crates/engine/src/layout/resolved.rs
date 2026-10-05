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
}

impl BoxValues {
    pub(crate) fn value(&self, name: &str) -> Result<String> {
        let value = match logical::physical(name) {
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
        })
    })
}
