use crate::dom_attributes::NativeAttributes;
use dom_query::NodeRef;
use lightningcss::{
    properties::font::AbsoluteFontWeight, stylesheet::PrinterOptions, traits::ToCss,
};

use crate::{
    Error, MediaEnvironment, Result,
    layout::{Sources, Work},
    styles::{Declarations, Variables},
};

#[derive(Clone)]
struct DeclaredSize {
    css: String,
    fonts: crate::fonts::Context,
    resolved: std::cell::OnceCell<String>,
}

impl DeclaredSize {
    fn value(&self, work: &mut Work<'_>) -> Result<String> {
        use lightningcss::{properties::size::Size, traits::Parse};
        if let Some(value) = self.resolved.get() {
            return Ok(value.clone());
        }
        let parsed = Size::parse_string(&self.css)
            .map_err(|_error| Error::Dom("computed size syntax".into()))?;
        let value = match parsed {
            Size::LengthPercentage(_) => {
                crate::position_value::Value::from_css(&self.css, &self.fonts, work, false)?
                    .nonnegative()
                    .value()
            }
            Size::FitContentFunction(value) => {
                let css = value
                    .to_css_string(PrinterOptions::default())
                    .map_err(|error| Error::Dom(error.to_string()))?;
                let value = crate::position_value::Value::from_css(&css, &self.fonts, work, false)?
                    .nonnegative()
                    .value()?;
                Ok(format!("fit-content({value})"))
            }
            value => value
                .to_css_string(PrinterOptions::default())
                .map_err(|error| Error::Dom(error.to_string())),
        }?;
        Ok(self.resolved.get_or_init(|| value).clone())
    }
}

struct DeclaredSizes {
    values: taffy::Size<Option<Box<DeclaredSize>>>,
    horizontal: bool,
}
impl Default for DeclaredSizes {
    fn default() -> Self {
        Self {
            values: taffy::Size::default(),
            horizontal: true,
        }
    }
}
impl DeclaredSizes {
    fn for_unboxed(
        self,
        node: NodeRef<'_>,
        display: &crate::display::Computed,
        visible: bool,
    ) -> Option<Self> {
        if self.horizontal
            && crate::html_boxes::html(node)
            && (!visible
                || display.contents()
                || display.inline_flow() && !crate::html_boxes::replaced(node))
        {
            Some(self)
        } else {
            None
        }
    }

    fn compute(&self, declarations: &Declarations, fonts: &crate::fonts::Context) -> Self {
        let mut result = taffy::Size {
            width: None,
            height: None,
        };
        for (name, value, _) in crate::layout::logical::entries(declarations, fonts.rtl()) {
            let (slot, previous) = match name {
                "width" => (&mut result.width, &self.values.width),
                "height" => (&mut result.height, &self.values.height),
                _ => continue,
            };
            *slot = match value {
                "inherit" => previous.clone(),
                "" | "auto" | "initial" | "unset" | "revert" => None,
                value => Some(Box::new(DeclaredSize {
                    css: value.to_owned(),
                    fonts: *fonts,
                    resolved: std::cell::OnceCell::new(),
                })),
            };
        }
        let horizontal = match declarations.value("writing-mode").0.as_str() {
            "" | "inherit" | "unset" | "revert" => self.horizontal,
            "initial" | "horizontal-tb" => true,
            _ => false,
        };
        Self {
            values: result,
            horizontal,
        }
    }
}

pub(crate) const PROPERTIES: [&str; 58] = [
    "background-attachment",
    "background-clip",
    "background-color",
    "background-image",
    "background-origin",
    "background-position",
    "background-repeat",
    "background-size",
    "block-size",
    "bottom",
    "color",
    "direction",
    "display",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "height",
    "inline-size",
    "inset-block-end",
    "inset-block-start",
    "inset-inline-end",
    "inset-inline-start",
    "left",
    "line-height",
    "margin-block-end",
    "margin-block-start",
    "margin-bottom",
    "margin-inline-end",
    "margin-inline-start",
    "margin-left",
    "margin-right",
    "margin-top",
    "order",
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
    "right",
    "tab-size",
    "text-size-adjust",
    "text-transform",
    "top",
    "transition-delay",
    "transition-duration",
    "transition-property",
    "transition-timing-function",
    "width",
    "z-index",
];

pub(crate) struct Computed {
    pub(crate) used_box: Option<crate::layout::resolved::BoxValues>,
    unboxed_sizes: Option<DeclaredSizes>,
    fonts: crate::fonts::Context,
    font_traits: crate::font_traits::Computed,
    outlines: crate::outlines::Outlines,
    background: crate::backgrounds::Color,
    images: crate::backgrounds::Images,
    positions: crate::background_position::Positions,
    repeats: crate::background_repeat::Repeats,
    sizes: crate::background_size::Sizes,
    layers: crate::background_layers::Layers,
    family: crate::font_family::Family,
    display: crate::display::Computed,
    position: &'static str,
    insets: crate::insets::Insets,
    box_visible: bool,
    index: crate::z_index::Index,
    order: i32,
    transitions: crate::transitions::Controls,
    transform: crate::text_transform::Transform,
}

pub(crate) fn property(name: &str) -> bool {
    PROPERTIES.contains(&name)
        || name == "transition"
        || crate::background_position::property(name)
        || crate::layout::resolved::property(name)
        || crate::insets::index(name, false).is_some()
}
impl Computed {
    pub(crate) fn needs_box(&self, name: &str) -> bool {
        if crate::layout::logical::group(name) == Some("size") && self.unboxed_sizes.is_some() {
            return false;
        }
        crate::layout::resolved::property(name)
            || (crate::insets::index(name, false).is_some()
                && self.position != "static"
                && self.box_visible
                && !self.display.none()
                && !self.display.contents())
    }
    pub(crate) fn value(&self, name: &str, work: &mut Work<'_>) -> Result<String> {
        if crate::layout::logical::group(name) == Some("size")
            && let Some(sizes) = &self.unboxed_sizes
        {
            let value = if crate::layout::logical::physical(name) == "width" {
                &sizes.values.width
            } else {
                &sizes.values.height
            };
            return value
                .as_ref()
                .map_or_else(|| Ok("auto".into()), |value| value.value(work));
        }
        if let Some(index) = crate::insets::index(name, self.fonts.rtl()) {
            self.insets.value(
                index,
                self.position,
                self.used_box.as_ref().filter(|_| self.needs_box(name)),
            )
        } else if crate::layout::resolved::property(name) {
            self.used_box
                .as_ref()
                .ok_or_else(|| Error::Dom("missing resolved box".into()))?
                .value(name)
        } else if crate::transitions::property(name) || name == "transition" {
            self.transitions.value(name)
        } else if name == "background-color" {
            self.background.value()
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
        } else if name == "text-transform" {
            Ok(self.transform.value().into())
        } else if name == "order" {
            Ok(self.order.to_string())
        } else if name == "z-index" {
            Ok(self.index.value())
        } else if name == "display" {
            self.display.value()
        } else if name == "font-style" {
            self.font_traits
                .style
                .to_css_string(PrinterOptions::default())
                .map_err(|error| Error::Dom(error.to_string()))
        } else if name == "font-weight" {
            AbsoluteFontWeight::Weight(self.font_traits.weight)
                .to_css_string(PrinterOptions::default())
                .map_err(|error| Error::Dom(error.to_string()))
        } else if name == "font-family" {
            self.family.value()
        } else if name == "line-height" {
            self.fonts.line_height()
        } else if name == "direction" {
            Ok(if self.fonts.rtl() { "rtl" } else { "ltr" }.into())
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
    target: NodeRef<'_>,
    sources: &Sources<'_>,
    media: &MediaEnvironment,
    work: &mut Work<'_>,
) -> Result<Computed> {
    let cascade = sources.cascade;
    if cascade.has_containers() {
        return Err(Error::Dom(
            "layout unsupported: computed style container queries".into(),
        ));
    }
    let mut variables = Variables::default();
    let mut fonts = crate::fonts::Context::new(media);
    let mut font_traits = crate::font_traits::Computed::default();
    let mut outlines = crate::outlines::Outlines::default();
    let mut background = crate::backgrounds::Color::default();
    let mut images = crate::backgrounds::Images::default();
    let mut positions = crate::background_position::Positions::default();
    let mut repeats = crate::background_repeat::Repeats::default();
    let mut sizes = crate::background_size::Sizes::default();
    let mut layers = crate::background_layers::Layers::default();
    let mut family = crate::font_family::Family::default();
    let mut display = crate::display::Computed::default();
    let mut position = "static";
    let mut insets = crate::insets::Insets::default();
    let mut box_visible = true;
    let mut index = crate::z_index::Index::default();
    let mut order = 0;
    let mut transform = crate::text_transform::Transform::default();
    let mut transitions = crate::transitions::Controls::default();
    let mut sizes_declared = DeclaredSizes::default();
    for (depth, node) in ancestors(target)?.into_iter().enumerate() {
        work.charge()?;
        let inline = sources.inline.get(&node.id).cloned().map_or_else(
            || {
                Declarations::parse(node.null_attribute("style").as_deref().unwrap_or_default())
                    .map_err(|error| Error::Dom(error.into()))
            },
            Ok,
        )?;
        let mut declarations = cascade.resolve(
            node,
            &inline,
            None,
            &crate::containers::Snapshot::new(),
            Some(&sources.controls),
            work,
        )?;
        (declarations, variables) =
            declarations.compute_registered(&variables, &cascade.registrations, work)?;
        let declarations = crate::html_boxes::computed_defaults(node, declarations)?;
        let declarations =
            cascade
                .animations
                .sample(&declarations, &variables, &cascade.registrations, work)?;
        transitions = transitions.compute(&declarations)?;
        let declarations =
            sources
                .transitions
                .borrow_mut()
                .sample(node, declarations, sources.now)?;
        transform = transform.compute(&declarations)?;
        fonts = fonts.compute(&declarations, depth == 0, work)?;
        font_traits = font_traits.compute(&declarations)?;
        outlines = outlines.compute(&declarations, &fonts, work)?;
        background = background.compute(&declarations, outlines.color(), work)?;
        images = images.compute(&declarations, &fonts, work)?;
        positions = positions.compute(&declarations, &fonts, work)?;
        repeats = repeats.compute(&declarations, images.count(), work)?;
        sizes = sizes.compute(&declarations, images.count(), &fonts, work)?;
        layers = layers.compute(&declarations, images.count(), work)?;
        family = family.compute(&declarations, work)?;
        index = index.compute(&declarations.value("z-index").0)?;
        order = crate::layout::order::compute(order, &declarations)?;
        position = computed_position(position, &declarations)?;
        insets = insets.compute(&declarations, &fonts, work)?;
        display = display.compute(node, &declarations, depth == 0, false)?;
        sizes_declared = sizes_declared.compute(&declarations, &fonts);
        box_visible &= !display.none();
    }
    Ok(Computed {
        used_box: None,
        unboxed_sizes: sizes_declared.for_unboxed(target, &display, box_visible),
        fonts,
        font_traits,
        outlines,
        background,
        images,
        positions,
        repeats,
        sizes,
        layers,
        family,
        display,
        position,
        insets,
        box_visible,
        index,
        order,
        transitions,
        transform,
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

fn computed_position(parent: &'static str, declarations: &Declarations) -> Result<&'static str> {
    match declarations.value("position").0.as_str() {
        "" | "initial" | "unset" | "revert" | "static" => Ok("static"),
        "inherit" => Ok(parent),
        "relative" => Ok("relative"),
        "absolute" => Ok("absolute"),
        "fixed" => Ok("fixed"),
        "sticky" => Ok("sticky"),
        _ => Err(Error::Dom("layout unsupported: computed position".into())),
    }
}
