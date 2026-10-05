use dom_query::{Document, NodeRef};

use crate::{
    Error, MediaEnvironment, Result,
    layout::{Sources, Work},
    styles::{Declarations, Variables},
};

pub(crate) const PROPERTIES: [&str; 44] = [
    "background-attachment",
    "background-clip",
    "background-image",
    "background-origin",
    "background-position",
    "background-repeat",
    "background-size",
    "block-size",
    "color",
    "display",
    "font-family",
    "font-size",
    "height",
    "inline-size",
    "line-height",
    "margin-block-end",
    "margin-block-start",
    "margin-bottom",
    "margin-inline-end",
    "margin-inline-start",
    "margin-left",
    "margin-right",
    "margin-top",
    "outline-color",
    "outline-offset",
    "outline-style",
    "outline-width",
    "padding-block-end",
    "padding-block-start",
    "padding-bottom",
    "padding-inline-end",
    "padding-inline-start",
    "padding-left",
    "padding-right",
    "padding-top",
    "position",
    "tab-size",
    "text-size-adjust",
    "transition-delay",
    "transition-duration",
    "transition-property",
    "transition-timing-function",
    "width",
    "z-index",
];

pub(crate) struct Computed {
    pub(crate) used_box: Option<crate::layout::resolved::BoxValues>,
    fonts: crate::fonts::Context,
    outlines: crate::outlines::Outlines,
    images: crate::backgrounds::Images,
    positions: crate::background_position::Positions,
    repeats: crate::background_repeat::Repeats,
    sizes: crate::background_size::Sizes,
    layers: crate::background_layers::Layers,
    family: crate::font_family::Family,
    display: crate::display::Computed,
    position: &'static str,
    index: crate::z_index::Index,
    transitions: crate::transitions::Controls,
}

pub(crate) fn property(name: &str) -> bool {
    PROPERTIES.contains(&name)
        || name == "transition"
        || crate::background_position::property(name)
        || crate::layout::resolved::property(name)
}
impl Computed {
    pub(crate) fn value(&self, name: &str) -> Result<String> {
        if crate::layout::resolved::property(name) {
            self.used_box
                .as_ref()
                .ok_or_else(|| Error::Dom("missing resolved box".into()))?
                .value(name)
        } else if crate::transitions::property(name) || name == "transition" {
            self.transitions.value(name)
        } else if name == "background-image" {
            self.images.value(self.outlines.color())
        } else if crate::background_layers::property(name) {
            self.layers.value(name, self.images.count())
        } else if name == "background-position" || crate::background_position::property(name) {
            self.positions.value(name, self.images.count())
        } else if name == "background-repeat" {
            self.repeats.value(self.images.count())
        } else if name == "background-size" {
            self.sizes.value()
        } else if name == "position" {
            Ok(self.position.to_owned())
        } else if name == "z-index" {
            Ok(self.index.value())
        } else if name == "display" {
            self.display.value()
        } else if name == "font-family" {
            self.family.value()
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
    let cascade = crate::cascade::Cascade::collect(
        document,
        sources.external,
        sources.constructed,
        sources.base,
        media,
        work,
    )?;
    if cascade.has_containers() {
        return Err(Error::Dom(
            "layout unsupported: computed style container queries".into(),
        ));
    }
    let ancestors = ancestors(target)?;
    let mut variables = Variables::default();
    let mut fonts = crate::fonts::Context::new(media);
    let mut outlines = crate::outlines::Outlines::default();
    let mut images = crate::backgrounds::Images::default();
    let mut positions = crate::background_position::Positions::default();
    let mut repeats = crate::background_repeat::Repeats::default();
    let mut sizes = crate::background_size::Sizes::default();
    let mut layers = crate::background_layers::Layers::default();
    let mut family = crate::font_family::Family::default();
    let mut display = crate::display::Computed::default();
    let mut position = "static";
    let mut index = crate::z_index::Index::default();
    let mut transitions = crate::transitions::Controls::default();
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
        transitions = transitions.compute(&declarations)?;
        let declarations =
            sources
                .transitions
                .borrow_mut()
                .sample(node, declarations, sources.now)?;
        fonts = fonts.compute(&declarations, depth == 0, work)?;
        outlines = outlines.compute(&declarations, &fonts, work)?;
        images = images.compute(&declarations, &fonts, work)?;
        positions = positions.compute(&declarations, &fonts, work)?;
        repeats = repeats.compute(&declarations, images.count(), work)?;
        sizes = sizes.compute(&declarations, images.count(), &fonts, work)?;
        layers = layers.compute(&declarations, images.count(), work)?;
        family = family.compute(&declarations, work)?;
        index = index.compute(&declarations.value("z-index").0)?;
        let (specified, _) = declarations.value("position");
        position = match specified.as_str() {
            "" | "initial" | "unset" | "revert" | "static" => "static",
            "inherit" => position,
            "relative" => "relative",
            "absolute" => "absolute",
            "fixed" => "fixed",
            "sticky" => "sticky",
            _ => return Err(Error::Dom("layout unsupported: computed position".into())),
        };
        display = display.compute(node, &declarations, depth == 0, false)?;
    }
    Ok(Computed {
        used_box: None,
        fonts,
        outlines,
        images,
        positions,
        repeats,
        sizes,
        layers,
        family,
        display,
        position,
        index,
        transitions,
    })
}

fn ancestors(target: NodeRef<'_>) -> Result<Vec<NodeRef<'_>>> {
    if !target.ancestors_it(None).any(|node| node.is_document()) {
        return Err(Error::Dom(
            "computed style requires an attached element".into(),
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
    Ok(ancestors)
}
