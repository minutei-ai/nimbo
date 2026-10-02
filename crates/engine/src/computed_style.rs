use dom_query::{Document, NodeRef};

use crate::{
    Error, MediaEnvironment, Result,
    layout::{Sources, Work},
    styles::{Declarations, Variables},
};

pub(crate) const PROPERTIES: [&str; 16] = [
    "background-attachment",
    "background-clip",
    "background-image",
    "background-origin",
    "background-position",
    "background-repeat",
    "background-size",
    "color",
    "font-size",
    "line-height",
    "outline-color",
    "outline-offset",
    "outline-style",
    "outline-width",
    "tab-size",
    "text-size-adjust",
];

pub(crate) struct Computed {
    fonts: crate::fonts::Context,
    outlines: crate::outlines::Outlines,
    images: crate::backgrounds::Images,
    positions: crate::background_position::Positions,
    repeats: crate::background_repeat::Repeats,
    sizes: crate::background_size::Sizes,
    layers: crate::background_layers::Layers,
}

pub(crate) fn property(name: &str) -> bool {
    PROPERTIES.contains(&name) || crate::background_position::property(name)
}
impl Computed {
    pub(crate) fn value(&self, name: &str) -> Result<String> {
        if name == "background-image" {
            self.images.value(self.outlines.color())
        } else if crate::background_layers::property(name) {
            self.layers.value(name, self.images.count())
        } else if name == "background-position" || crate::background_position::property(name) {
            self.positions.value(name, self.images.count())
        } else if name == "background-repeat" {
            self.repeats.value(self.images.count())
        } else if name == "background-size" {
            self.sizes.value()
        } else if name == "line-height" {
            self.fonts.line_height()
        } else if name == "tab-size" {
            self.fonts.tabs()
        } else if name == "text-size-adjust" {
            self.fonts.adjustment()
        } else {
            self.outlines.value(name, &self.fonts)
        }
    }
}

pub(crate) fn resolve(
    document: &Document,
    target: NodeRef<'_>,
    sources: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Computed> {
    if !target.ancestors_it(None).any(|node| node.is_document()) {
        return Err(Error::Dom(
            "computed style requires an attached element".into(),
        ));
    }
    let cascade =
        crate::cascade::Cascade::collect(document, sources.external, sources.base, media, work)?;
    if cascade.has_containers() {
        return Err(Error::Dom(
            "layout unsupported: computed style container queries".into(),
        ));
    }
    let mut ancestors: Vec<_> = target
        .ancestors_it(None)
        .filter(NodeRef::is_element)
        .collect();
    ancestors.reverse();
    ancestors.push(target);
    if ancestors.len() > 128 {
        return Err(Error::Limit("computed style depth"));
    }
    let mut variables = Variables::default();
    let mut fonts = crate::fonts::Context::new(media);
    let mut outlines = crate::outlines::Outlines::default();
    let mut images = crate::backgrounds::Images::default();
    let mut positions = crate::background_position::Positions::default();
    let mut repeats = crate::background_repeat::Repeats::default();
    let mut sizes = crate::background_size::Sizes::default();
    let mut layers = crate::background_layers::Layers::default();
    for (depth, node) in ancestors.into_iter().enumerate() {
        work.charge()?;
        let inline = sources.inline.get(&node.id).cloned().map_or_else(
            || {
                Declarations::parse(node.attr("style").as_deref().unwrap_or_default())
                    .map_err(|error| Error::Dom(error.into()))
            },
            Ok,
        )?;
        let declarations = cascade.resolve(
            node,
            &inline,
            None,
            &crate::containers::Snapshot::new(),
            work,
        )?;
        let (declarations, next_variables) =
            declarations.compute_registered(&variables, &cascade.registrations, work)?;
        variables = next_variables;
        let declarations = cascade.animations.sample(&declarations, &variables, work)?;
        fonts = fonts.compute(&declarations, depth == 0, work)?;
        outlines = outlines.compute(&declarations, &fonts, work)?;
        images = images.compute(&declarations, &fonts, work)?;
        positions = positions.compute(&declarations, &fonts, work)?;
        repeats = repeats.compute(&declarations, images.count(), work)?;
        sizes = sizes.compute(&declarations, images.count(), &fonts, work)?;
        layers = layers.compute(&declarations, images.count(), work)?;
    }
    Ok(Computed {
        fonts,
        outlines,
        images,
        positions,
        repeats,
        sizes,
        layers,
    })
}
