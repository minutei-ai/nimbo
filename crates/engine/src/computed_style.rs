use dom_query::{Document, NodeRef};

use crate::{
    Error, MediaEnvironment, Result,
    layout::{Sources, Work},
    styles::{Declarations, Variables},
};

pub(crate) const PROPERTIES: [&str; 8] = [
    "color",
    "font-size",
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
}
impl Computed {
    pub(crate) fn value(&self, name: &str) -> Result<String> {
        if name == "tab-size" {
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
    }
    Ok(Computed { fonts, outlines })
}
