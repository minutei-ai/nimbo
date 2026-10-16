//! Native loaded-font advances, collapsed whitespace and greedy line breaking.
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};

use crate::font_data::Faces;
use harfrust::Font;
use lightningcss::{properties::font::FontStyle, stylesheet::PrinterOptions, traits::ToCss};
use num_traits::ToPrimitive;
use taffy::prelude::*;
use unicode_segmentation::UnicodeSegmentation;

use super::{
    replaced,
    text_source::{self, Padding},
    unsupported,
};
use crate::{Result, dom_attributes::NativeAttributes, styles::Declarations};
use taffy::util::ResolveOrZero;

#[derive(Clone, PartialEq)]
pub(super) struct Typography {
    traits: crate::font_traits::Computed,
    spacing: f64,
    stretch: String,
    variant: String,
    whitespace: String,
    overflow_wrap: String,
    transform: crate::text_transform::Transform,
    language: String,
    align: String,
}
impl Default for Typography {
    fn default() -> Self {
        Self {
            traits: crate::font_traits::Computed::default(),
            spacing: 0.0,
            stretch: "normal".into(),
            variant: "normal".into(),
            whitespace: "normal".into(),
            overflow_wrap: "normal".into(),
            transform: crate::text_transform::Transform::default(),
            language: "und".into(),
            align: "start".into(),
        }
    }
}
impl Typography {
    /// Inline placement for `text-align`, resolved against the box's direction.
    pub(super) fn justify(&self, rtl: bool) -> Result<JustifyContent> {
        Ok(match (self.align.as_str(), rtl) {
            ("start", _) | ("left", false) | ("right", true) => JustifyContent::START,
            ("end", _) | ("right", false) | ("left", true) => JustifyContent::END,
            ("center", _) => JustifyContent::CENTER,
            _ => return Err(unsupported("text-align")),
        })
    }
    pub(super) fn same_flow(&self, other: &Self) -> bool {
        self.whitespace == other.whitespace
            && self.overflow_wrap == other.overflow_wrap
            && self.transform == other.transform
            && self.language == other.language
            && self.align == other.align
    }
    pub(super) fn preserves_breaks(&self) -> bool {
        self.whitespace == "pre-line"
    }
    pub(super) fn zero_advance(
        &self,
        fonts: &crate::fonts::Context,
        family: &crate::font_family::Family,
        arena: &crate::font_data::Arena,
        work: &mut super::Work<'_>,
    ) -> Result<f64> {
        work.charge()?;
        let font = arena.select(
            format!(
                "{} {} {}px {}",
                self.traits
                    .style
                    .to_css_string(PrinterOptions::default())
                    .map_err(|error| crate::Error::Dom(error.to_string()))?,
                self.traits.weight,
                fonts.size(),
                family.value()?
            ),
            "0",
        )?;
        crate::font_data::measure(&font, "0", fonts.size()).map_err(unsupported)
    }
    pub(super) fn x_height(
        &self,
        fonts: &crate::fonts::Context,
        family: &crate::font_family::Family,
        arena: &crate::font_data::Arena,
        work: &mut super::Work<'_>,
    ) -> Result<f32> {
        work.charge()?;
        let font = arena.select(
            format!(
                "{} {} {}px {}",
                self.traits
                    .style
                    .to_css_string(PrinterOptions::default())
                    .map_err(|error| crate::Error::Dom(error.to_string()))?,
                self.traits.weight,
                fonts.size(),
                family.value()?
            ),
            "",
        )?;
        let metrics = font.metrics();
        let height = metrics
            .x_height
            .ok_or_else(|| unsupported("font x-height"))?
            .to_f64()
            * fonts.size()
            / f64::from(metrics.units_per_em);
        height
            .to_f32()
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or_else(|| unsupported("font x-height range"))
    }
    pub(super) fn compute(
        &self,
        declarations: &Declarations,
        node: dom_query::NodeRef<'_>,
        fonts: &crate::fonts::Context,
        work: &mut super::Work<'_>,
    ) -> Result<Self> {
        fn inherited(declarations: &Declarations, name: &str, old: &str) -> String {
            let (value, _) = declarations.value(name);
            match value.as_str() {
                "" | "inherit" | "unset" | "revert" => old.into(),
                "initial" => "normal".into(),
                _ => value,
            }
        }
        // Supported runs use default OpenType features and no variation axes.
        // Validate individual longhands too, so partial shorthands cannot hide
        // a non-default setting behind an empty shorthand serialization.
        for (name, value, _) in declarations.layout_entries() {
            if (name.starts_with("font-variant-")
                || matches!(name, "font-feature-settings" | "font-variation-settings"))
                && !matches!(value, "normal" | "initial" | "unset" | "inherit" | "revert")
            {
                return Err(unsupported("text font features or variations"));
            }
        }
        let (value, _) = declarations.value("letter-spacing");
        let spacing = match value.as_str() {
            "" | "inherit" | "unset" | "revert" => self.spacing,
            "initial" | "normal" => 0.0,
            _ => {
                use lightningcss::{traits::Parse, values::length::Length};
                let length =
                    Length::parse_string(&value).map_err(|_error| unsupported("letter-spacing"))?;
                fonts.length(&length, work)?
            }
        };
        let language = node.null_attribute("lang").map_or_else(
            || self.language.clone(),
            |value| {
                let base = value.split('-').next().unwrap_or_default();
                if (2..=8).contains(&base.len())
                    && base.bytes().all(|byte| byte.is_ascii_alphabetic())
                {
                    base.to_ascii_lowercase()
                } else {
                    "und".into()
                }
            },
        );
        Ok(Self {
            transform: self.transform.compute(declarations)?,
            language,
            traits: self.traits.compute(declarations)?,
            spacing,
            stretch: inherited(declarations, "font-stretch", &self.stretch),
            variant: inherited(declarations, "font-variant", &self.variant),
            whitespace: inherited(declarations, "white-space", &self.whitespace),
            overflow_wrap: inherited(declarations, "overflow-wrap", &self.overflow_wrap),
            align: match declarations.value("text-align").0.as_str() {
                "" | "inherit" | "unset" | "revert" => self.align.clone(),
                "initial" => "start".into(),
                value => value.to_owned(),
            },
        })
    }
}

const FONT_COMPARISON_WORK: usize = 8;
const SPAN_WORK: usize = 24;
const PADDING_WORK: usize = 16;

#[derive(Default)]
pub(super) struct Budget {
    bytes: Cell<usize>,
    error: RefCell<Option<crate::Error>>,
}
impl Budget {
    pub(super) fn check(&self) -> Result<()> {
        self.error.borrow_mut().take().map_or(Ok(()), Err)
    }
    fn charge(&self, bytes: usize) -> Result<()> {
        self.bytes
            .set(self.bytes.get().saturating_add(bytes.max(1)));
        if self.bytes.get() > 1_048_576 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        Ok(())
    }
    fn shape(&self, faces: &Faces, source: &str, size: f64, spacing: f64) -> Result<f64> {
        if source.len() > 65_536 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        self.charge(source.len())?;
        crate::font_data::measure_faces(faces, source, size, spacing).map_err(unsupported)
    }
}

pub(super) enum Intrinsic {
    Replaced(replaced::Intrinsic),
    Text(Box<Run>),
}
impl Intrinsic {
    pub(super) fn layout(&self, inputs: taffy::LayoutInput, style: &Style) -> taffy::LayoutOutput {
        match self {
            Self::Replaced(value) => value.layout(inputs, style),
            Self::Text(run) => run.layout(inputs, style),
        }
    }
}

impl Run {
    pub(super) fn layout(&self, inputs: taffy::LayoutInput, style: &Style) -> taffy::LayoutOutput {
        self.leaf_layout(inputs, style, |known, available| {
            self.measured(known, available, &[])
        })
        .0
    }
    pub(super) fn leaf_layout(
        &self,
        inputs: taffy::LayoutInput,
        style: &Style,
        mut measure: impl FnMut(Size<Option<f32>>, Size<AvailableSpace>) -> Measured,
    ) -> (taffy::LayoutOutput, Measured) {
        use taffy::util::ResolveOrZero;
        let mut measured = None;
        let mut output = taffy::compute::compute_leaf_layout(
            inputs,
            style,
            |_, _| 0.0,
            |known, available| {
                let value = measure(known, available);
                let size = value.size;
                measured = Some(value);
                size
            },
        );
        let padding = style
            .padding
            .resolve_or_zero(inputs.parent_size.width, |_, _| 0.0);
        let border = style
            .border
            .resolve_or_zero(inputs.parent_size.width, |_, _| 0.0);
        let inset = Rect {
            top: padding.top + border.top,
            right: padding.right + border.right,
            bottom: padding.bottom + border.bottom,
            left: padding.left + border.left,
        };
        let size = measured.unwrap_or_else(|| {
            measure(
                Size {
                    width: Some((output.size.width - inset.horizontal_axis_sum()).max(0.0)),
                    height: None,
                },
                Size::MAX_CONTENT,
            )
        });
        let first = f64::from(inset.top) + size.first;
        let last = f64::from(inset.top) + size.last;
        match (first.to_f32(), last.to_f32()) {
            (Some(first), Some(last)) if first.is_finite() && last.is_finite() => {
                output.baselines = taffy::Baselines {
                    first: Some(first),
                    last: Some(last),
                };
            }
            _ => *self.budget.error.borrow_mut() = Some(unsupported("text baseline range")),
        }
        (output, size)
    }
}

fn line_metrics(font: &Font, size: f64, height: &str) -> Result<(f64, f64, f64, f64)> {
    let metrics = font.metrics();
    let line = if metrics.use_typo_metrics {
        metrics.typo_line
    } else {
        metrics
            .hhea_line
            .filter(|line| line.ascender.to_f64() != 0.0 || line.descender.to_f64() != 0.0)
            .or(metrics.typo_line)
    }
    .ok_or_else(|| unsupported("text normal line metrics"))?;
    let scale = size / f64::from(metrics.units_per_em);
    let ascent = (line.ascender.to_f64() * scale).round();
    let descent = (-line.descender.to_f64() * scale).round();
    let gap = (line.line_gap.to_f64() * scale).max(0.0).round();
    let height = if height == "normal" {
        ascent + descent + gap
    } else {
        height
            .strip_suffix("px")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or_else(|| unsupported("text line metrics"))?
    };
    Ok((
        height,
        ascent + ((height - ascent - descent) / 2.0).floor(),
        ascent,
        descent,
    ))
}

#[derive(Clone, PartialEq)]
pub(super) struct Metrics {
    fonts: crate::fonts::Context,
    typography: Typography,
    family: crate::font_family::Family,
}
impl Metrics {
    pub(super) fn new(context: &super::BoxContext) -> Self {
        Self {
            fonts: context.fonts,
            typography: context.typography.clone(),
            family: context.family.clone(),
        }
    }
    pub(super) fn same(left: &super::BoxContext, right: &super::BoxContext) -> bool {
        left.fonts == right.fonts
            && left.typography == right.typography
            && left.family == right.family
    }
    pub(super) fn matches(&self, context: &super::BoxContext) -> bool {
        self.fonts == context.fonts
            && self.typography == context.typography
            && self.family == context.family
    }
}

struct FontRun {
    faces: Faces,
    size: f64,
    height: f64,
    baseline: f64,
    box_ascent: f64,
    box_descent: f64,
    spacing: f64,
    budget: Rc<Budget>,
    advances: RefCell<HashMap<String, f64>>,
}
impl FontRun {
    fn new(
        source: &str,
        typography: &Typography,
        context: &crate::fonts::Context,
        family: &crate::font_family::Family,
        fonts: &crate::font_data::Arena,
        budget: Rc<Budget>,
    ) -> Result<Self> {
        if !matches!(
            typography.traits.style,
            FontStyle::Normal | FontStyle::Italic
        ) || !matches!(typography.stretch.as_str(), "normal" | "100%")
            || typography.variant != "normal"
        {
            return Err(unsupported("text font synthesis or spacing"));
        }
        let size = context.size();
        let faces = fonts.select_faces(
            format!(
                "{} {} {size}px {}",
                typography
                    .traits
                    .style
                    .to_css_string(PrinterOptions::default())
                    .map_err(|error| crate::Error::Dom(error.to_string()))?,
                typography.traits.weight,
                family.value()?
            ),
            if source.is_empty() { " " } else { source },
        )?;
        let line_height = context.line_height()?;
        let (primary, fallback) = faces
            .split_first()
            .ok_or_else(|| unsupported("text font selection"))?;
        let (height, baseline, box_ascent, box_descent) =
            line_metrics(&primary.0, size, &line_height)?;
        // Fallback glyphs from a face with other metrics would grow normal line boxes.
        for (font, _) in fallback {
            let (fallback_height, fallback_baseline, _, _) =
                line_metrics(font, size, &line_height)?;
            if (fallback_height, fallback_baseline) != (height, baseline) {
                return Err(unsupported("font fallback line metrics"));
            }
        }
        Ok(Self {
            faces,
            size,
            height,
            baseline,
            box_ascent,
            box_descent,
            spacing: typography.spacing,
            budget,
            advances: RefCell::new(HashMap::new()),
        })
    }
    fn width(&self, source: &str) -> Result<f64> {
        if let Some(advance) = self.advances.borrow().get(source) {
            return Ok(*advance);
        }
        let advance = self
            .budget
            .shape(&self.faces, source, self.size, self.spacing)?;
        self.advances
            .borrow_mut()
            .insert(source.to_owned(), advance);
        Ok(advance)
    }
}

struct StyledRun {
    start: usize,
    end: usize,
    font: usize,
    node: Option<dom_query::NodeId>,
}

struct StyledFonts {
    fonts: Vec<FontRun>,
    spans: Vec<StyledRun>,
    boxes: Vec<StyledRun>,
}
impl StyledFonts {
    fn new(
        spans: &[text_source::Span],
        boxes: &[text_source::Span],
        source: &str,
        fonts: &crate::font_data::Arena,
        budget: &Rc<Budget>,
    ) -> Result<Self> {
        let mut groups: Vec<(&Metrics, String)> = Vec::new();
        let mut styled = Vec::with_capacity(spans.len());
        let mut inline_boxes = Vec::with_capacity(boxes.len());
        for (span, glyphs) in spans
            .iter()
            .map(|span| (span, true))
            .chain(boxes.iter().map(|span| (span, false)))
        {
            budget.charge(SPAN_WORK)?;
            let mut found = None;
            for (index, (metrics, _)) in groups.iter().enumerate() {
                budget.charge(FONT_COMPARISON_WORK)?;
                if *metrics == &span.metrics {
                    found = Some(index);
                    break;
                }
            }
            let index = if let Some(index) = found {
                index
            } else {
                let index = groups.len();
                groups.push((&span.metrics, String::new()));
                index
            };
            if glyphs {
                let source = source
                    .get(span.start..span.end)
                    .ok_or_else(|| unsupported("inline text boundary"))?;
                groups
                    .get_mut(index)
                    .ok_or_else(|| unsupported("inline font boundary"))?
                    .1
                    .push_str(source);
            }
            let target = if glyphs {
                &mut styled
            } else {
                &mut inline_boxes
            };
            target.push(StyledRun {
                start: span.start,
                end: span.end,
                font: index,
                node: span.node,
            });
        }
        let mut shaped = Vec::with_capacity(groups.len());
        for (metrics, source) in groups {
            shaped.push(FontRun::new(
                &source,
                &metrics.typography,
                &metrics.fonts,
                &metrics.family,
                fonts,
                Rc::clone(budget),
            )?);
        }
        Ok(Self {
            fonts: shaped,
            spans: styled,
            boxes: inline_boxes,
        })
    }
}

pub(super) struct Measured {
    pub size: Size<f32>,
    pub first: f64,
    pub last: f64,
    pub lines: Vec<Line>,
}

#[derive(Clone)]
pub(super) struct Line {
    pub start: usize,
    pub end: usize,
    pub width: f64,
    pub y: f64,
    pub baseline: f64,
}

pub(super) struct Object {
    pub index: usize,
    pub layout: Layout,
    pub baseline: f64,
    pub top: bool,
    pub relative: taffy::Point<f32>,
}

#[derive(Default)]
struct Lines {
    width: f64,
    height: f64,
    first: Option<f64>,
    last: f64,
    fragments: Vec<Line>,
}
impl Lines {
    fn append(&mut self, width: f64, height: f64, first: f64, last: f64) {
        self.width = self.width.max(width);
        if self.first.is_none() {
            self.first = Some(self.height + first);
        }
        self.last = self.height + last;
        self.height += height;
    }
}

pub(super) struct Run {
    font: FontRun,
    styled: Option<Box<StyledFonts>>,
    source: String,
    padding: Vec<Padding>,
    nowrap: bool,
    overflow_wrap: String,
    budget: Rc<Budget>,
    pub atoms: Vec<text_source::Atom>,
    pub rtl: bool,
    pub justify: JustifyContent,
}
impl Run {
    pub(super) fn record(&self, error: crate::Error) {
        if self.budget.error.borrow().is_none() {
            *self.budget.error.borrow_mut() = Some(error);
        }
    }
    pub(super) fn failed(&self, error: crate::Error) -> Measured {
        self.record(error);
        Measured {
            size: Size::ZERO,
            first: 0.0,
            last: 0.0,
            lines: Vec::new(),
        }
    }
    pub(super) fn line_height(&self) -> f64 {
        self.font.height
    }
    pub(super) fn new(
        source: &text_source::Source<'_>,
        typography: &Typography,
        context: &super::BoxContext,
        fonts: &crate::font_data::Arena,
        budget: Rc<Budget>,
    ) -> Result<Option<Self>> {
        Self::parse(source, typography, context, fonts, budget, false)
    }
    pub(super) fn strut(
        typography: &Typography,
        context: &super::BoxContext,
        fonts: &crate::font_data::Arena,
        budget: Rc<Budget>,
    ) -> Result<Self> {
        Self::parse(
            &text_source::Source::new(context),
            typography,
            context,
            fonts,
            budget,
            true,
        )?
        .ok_or_else(|| unsupported("inline font strut"))
    }
    fn parse(
        source: &text_source::Source<'_>,
        typography: &Typography,
        context: &super::BoxContext,
        fonts: &crate::font_data::Arena,
        budget: Rc<Budget>,
        strut: bool,
    ) -> Result<Option<Self>> {
        if !matches!(
            typography.whitespace.as_str(),
            "normal" | "nowrap" | "pre-line"
        ) {
            return Err(unsupported("text white-space"));
        }
        let normalized = text_source::normalize(source, typography.preserves_breaks())?;
        let padding = normalized.padding;
        let spans = normalized.spans;
        let boxes = normalized.boxes;
        let atoms = normalized.atoms;
        let normalized = normalized.text;
        if !atoms.is_empty()
            && !matches!(typography.transform, crate::text_transform::Transform::None)
            && normalized
                .chars()
                .any(|c| !c.is_whitespace() && c != '\u{fffc}')
        {
            return Err(unsupported("mixed inline text transformation"));
        }
        if !atoms.is_empty() && !padding.is_empty() {
            return Err(unsupported("mixed inline padding"));
        }
        if !atoms.is_empty()
            && context.fonts.rtl()
            && normalized
                .chars()
                .any(|c| !c.is_whitespace() && c != '\u{fffc}')
        {
            return Err(unsupported("mixed bidi inline formatting"));
        }
        if !padding.is_empty()
            && !matches!(typography.transform, crate::text_transform::Transform::None)
        {
            return Err(unsupported("transformed inline padding"));
        }
        if (!spans.is_empty() || !boxes.is_empty())
            && !matches!(typography.transform, crate::text_transform::Transform::None)
        {
            return Err(unsupported("transformed inline metrics"));
        }
        if normalized.is_empty() && padding.is_empty() && !strut {
            return Ok(None);
        }
        if normalized.len() > 65_536 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        if !matches!(typography.transform, crate::text_transform::Transform::None) {
            budget.charge(normalized.len())?;
        }
        if budget.bytes.get() > 1_048_576 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        let normalized = match typography.transform {
            crate::text_transform::Transform::None => normalized,
            transform => transform.apply(&normalized, &typography.language)?,
        };
        let mut glyphs = std::borrow::Cow::Borrowed(normalized.as_str());
        for atom in atoms.iter().rev() {
            glyphs.to_mut().replace_range(
                atom.index..atom.index.saturating_add('\u{fffc}'.len_utf8()),
                "   ",
            );
        }
        let base_source = if spans.is_empty() {
            glyphs.as_ref()
        } else {
            ""
        };
        let font = FontRun::new(
            base_source,
            typography,
            &context.fonts,
            &context.family,
            fonts,
            Rc::clone(&budget),
        )?;
        for line in base_source.split('\n') {
            font.width(line)?;
        }
        let styled = if spans.is_empty() && boxes.is_empty() {
            None
        } else {
            Some(Box::new(StyledFonts::new(
                &spans, &boxes, &glyphs, fonts, &budget,
            )?))
        };
        Ok(Some(Self {
            font,
            styled,
            source: normalized,
            padding,
            nowrap: typography.whitespace == "nowrap",
            overflow_wrap: typography.overflow_wrap.clone(),
            budget,
            atoms,
            rtl: context.fonts.rtl(),
            justify: typography.justify(context.fonts.rtl())?,
        }))
    }
    fn styled_width(&self, start: usize, end: usize) -> Result<f64> {
        let Some(styled) = self
            .styled
            .as_ref()
            .filter(|styled| !styled.spans.is_empty())
        else {
            return self.font.width(
                self.source
                    .get(start..end)
                    .ok_or_else(|| unsupported("inline text boundary"))?,
            );
        };
        let mut width = 0.0;
        let first = styled.spans.partition_point(|span| span.end <= start);
        for span in styled
            .spans
            .get(first..)
            .ok_or_else(|| unsupported("inline text boundary"))?
        {
            if span.start >= end {
                break;
            }
            self.budget.charge(SPAN_WORK)?;
            let source = self
                .source
                .get(start.max(span.start)..end.min(span.end))
                .ok_or_else(|| unsupported("inline text boundary"))?;
            width += styled
                .fonts
                .get(span.font)
                .ok_or_else(|| unsupported("inline font boundary"))?
                .width(source)?;
        }
        Ok(width)
    }
    fn content_width(&self, start: usize, end: usize, objects: &[Object]) -> Result<f64> {
        if objects.is_empty() {
            return self.styled_width(start, end);
        }
        let mut width = 0.0;
        let mut cursor = start;
        let first = objects.partition_point(|object| object.index < start);
        for object in objects
            .iter()
            .skip(first)
            .take_while(|object| object.index < end)
        {
            self.budget.charge(SPAN_WORK)?;
            width += self.styled_width(cursor, object.index)?
                + f64::from(object.layout.size.width + object.layout.margin.horizontal_axis_sum());
            cursor = object.index.saturating_add('\u{fffc}'.len_utf8());
        }
        Ok(width + self.styled_width(cursor, end)?)
    }
    pub(super) fn range_width(
        &self,
        start: usize,
        end: usize,
        basis: Option<f32>,
        objects: &[Object],
    ) -> Result<f64> {
        if self.padding.is_empty() {
            return self.content_width(start, end, objects);
        }
        let mut width = 0.0;
        let mut cursor = start;
        let first = self
            .padding
            .partition_point(|padding| padding.index < start);
        for padding in self
            .padding
            .get(first..)
            .ok_or_else(|| unsupported("inline text boundary"))?
        {
            if padding.index > end {
                break;
            }
            self.budget.charge(PADDING_WORK)?;
            if padding.index == start
                && start > 0
                && !self
                    .source
                    .get(..start)
                    .is_some_and(|prefix| prefix.ends_with([' ', '\n']))
            {
                continue;
            }
            let advance = padding.width.resolve_or_zero(basis, |_, _| 0.0);
            if advance == 0.0 {
                continue;
            }
            width += self.content_width(cursor, padding.index, objects)? + f64::from(advance);
            cursor = padding.index;
        }
        Ok(width + self.content_width(cursor, end, objects)?)
    }
    pub(super) fn measured(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
        objects: &[Object],
    ) -> Measured {
        match self.measure(known, available, objects) {
            Ok(value) => value,
            Err(error) => self.failed(error),
        }
    }
    fn line_metrics(&self, start: usize, end: usize, objects: &[Object]) -> Result<(f64, f64)> {
        let mut ascent = self.font.baseline;
        let mut descent = self.font.height - self.font.baseline;
        let mut top = 0.0_f64;
        let first = objects.partition_point(|object| object.index < start);
        for object in objects
            .iter()
            .skip(first)
            .take_while(|object| object.index < end)
        {
            self.budget.charge(SPAN_WORK)?;
            if object.top {
                top = top.max(f64::from(
                    object.layout.size.height + object.layout.margin.vertical_axis_sum(),
                ));
                continue;
            }
            ascent = ascent.max(object.baseline);
            descent = descent.max(
                f64::from(object.layout.size.height + object.layout.margin.vertical_axis_sum())
                    - object.baseline,
            );
        }
        let Some(styled) = &self.styled else {
            return Ok(((ascent + descent).max(top), ascent));
        };
        let first = styled.spans.partition_point(|span| span.end <= start);
        for span in styled
            .spans
            .get(first..)
            .ok_or_else(|| unsupported("inline text boundary"))?
        {
            if span.start >= end {
                break;
            }
            self.budget.charge(SPAN_WORK)?;
            let font = styled
                .fonts
                .get(span.font)
                .ok_or_else(|| unsupported("inline font boundary"))?;
            ascent = ascent.max(font.baseline);
            descent = descent.max(font.height - font.baseline);
        }
        let first = styled.boxes.partition_point(|span| span.end < start);
        for span in styled
            .boxes
            .get(first..)
            .ok_or_else(|| unsupported("inline text boundary"))?
        {
            self.budget.charge(SPAN_WORK)?;
            if span.start > end {
                continue;
            }
            if span.end == start
                && start > 0
                && (span.start < span.end
                    || !self
                        .source
                        .get(..start)
                        .is_some_and(|prefix| prefix.ends_with([' ', '\n'])))
            {
                continue;
            }
            let font = styled
                .fonts
                .get(span.font)
                .ok_or_else(|| unsupported("inline font boundary"))?;
            ascent = ascent.max(font.baseline);
            descent = descent.max(font.height - font.baseline);
        }
        Ok(((ascent + descent).max(top), ascent))
    }
    fn append_line(
        &self,
        lines: &mut Lines,
        start: usize,
        end: usize,
        basis: Option<f32>,
        objects: &[Object],
    ) -> Result<()> {
        let (height, baseline) = self.line_metrics(start, end, objects)?;
        let width = self.range_width(start, end, basis, objects)?;
        if !self.atoms.is_empty() {
            lines.fragments.push(Line {
                start,
                end,
                width,
                y: lines.height,
                baseline,
            });
        }
        lines.append(width, height, baseline, baseline);
        Ok(())
    }
    fn measure(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
        objects: &[Object],
    ) -> Result<Measured> {
        let source = if self
            .padding
            .iter()
            .any(|padding| padding.index == self.source.len())
        {
            self.source.as_str()
        } else {
            self.source.strip_suffix('\n').unwrap_or(&self.source)
        };
        let mut lines = Lines::default();
        let mut start = 0_usize;
        for paragraph in source.split('\n') {
            let end = start.saturating_add(paragraph.len());
            let paragraph = self.paragraph(start, end, known, available, objects)?;
            lines
                .fragments
                .extend(paragraph.fragments.into_iter().map(|mut line| {
                    line.y += lines.height;
                    line
                }));
            lines.append(
                paragraph.width,
                paragraph.height,
                paragraph.first.unwrap_or(self.font.baseline),
                paragraph.last,
            );
            start = end.saturating_add(1);
        }
        let number = |value: f64| {
            value
                .to_f32()
                .filter(|value| value.is_finite())
                .ok_or_else(|| unsupported("text metric range"))
        };
        Ok(Measured {
            size: Size {
                width: number(lines.width)?,
                height: number(lines.height)?,
            },
            first: lines.first.unwrap_or(self.font.baseline),
            last: lines.last,
            lines: lines.fragments,
        })
    }
    fn words(
        &self,
        start: usize,
        end: usize,
    ) -> Result<impl Iterator<Item = std::ops::Range<usize>> + '_> {
        let source = self
            .source
            .get(start..end)
            .ok_or_else(|| unsupported("inline word boundary"))?;
        let mut chars = source.char_indices();
        let mut cursor = start;
        let mut pending = None;
        Ok(std::iter::from_fn(move || {
            if let Some(range) = pending.take() {
                return Some(range);
            }
            for (offset, ch) in chars.by_ref() {
                let index = start.saturating_add(offset);
                if ch == ' ' {
                    let range = cursor..index;
                    cursor = index.saturating_add(1);
                    if range.is_empty() {
                        continue;
                    }
                    return Some(range);
                }
                if ch == '\u{fffc}'
                    && self
                        .atoms
                        .binary_search_by_key(&index, |atom| atom.index)
                        .is_ok()
                {
                    let before = cursor..index;
                    let object = index..index.saturating_add(ch.len_utf8());
                    cursor = object.end;
                    if before.is_empty() {
                        return Some(object);
                    }
                    pending = Some(object);
                    return Some(before);
                }
            }
            if cursor < end || start == end && cursor == end {
                let range = cursor..end;
                cursor = end.saturating_add(1);
                return Some(range);
            }
            None
        }))
    }

    pub(super) fn fragments(
        &self,
        measured: &Measured,
        objects: &[Object],
        width: f64,
    ) -> Result<HashMap<dom_query::NodeId, Vec<super::Bounds>>> {
        let mut fragments: HashMap<_, Vec<_>> = HashMap::new();
        let Some(styled) = &self.styled else {
            return Ok(fragments);
        };
        for span in &styled.boxes {
            let Some(node) = span.node else {
                continue;
            };
            let font = styled
                .fonts
                .get(span.font)
                .ok_or_else(|| unsupported("inline font boundary"))?;
            let first = measured
                .lines
                .partition_point(|line| line.end <= span.start);
            for line in measured
                .lines
                .iter()
                .skip(first)
                .take_while(|line| line.start < span.end)
            {
                self.budget.charge(SPAN_WORK)?;
                let start = span.start.max(line.start);
                let end = span.end.min(line.end);
                let prefix = self.range_width(line.start, start, None, objects)?;
                let extent = self.range_width(start, end, None, objects)?;
                let offset = self.line_offset(line.width, width);
                let x = if self.rtl {
                    line.width - prefix - extent
                } else {
                    prefix
                };
                fragments.entry(node).or_default().push(super::Bounds {
                    x: offset + x,
                    y: line.y + line.baseline - font.box_ascent,
                    width: extent,
                    height: font.box_ascent + font.box_descent,
                });
            }
        }
        Ok(fragments)
    }
    pub(super) fn line_offset(&self, line: f64, width: f64) -> f64 {
        let free = width - line;
        match (self.justify, self.rtl) {
            (JustifyContent::CENTER, _) => free / 2.0,
            (JustifyContent::END, false) | (JustifyContent::START, true) => free,
            _ => 0.0,
        }
    }
    fn paragraph(
        &self,
        start: usize,
        end: usize,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
        objects: &[Object],
    ) -> Result<Lines> {
        let basis = known.width.or(match available.width {
            AvailableSpace::Definite(value) => Some(value),
            _ => None,
        });
        let maximum = self.range_width(start, end, basis, objects)?;
        let constraint = basis.map(f64::from);
        let minimum =
            matches!(available.width, AvailableSpace::MinContent) && known.width.is_none();
        if self.nowrap || (!minimum && constraint.is_none_or(|limit| maximum <= limit)) {
            let mut lines = Lines::default();
            self.append_line(&mut lines, start, end, basis, objects)?;
            return Ok(lines);
        }
        let limit = if minimum {
            0.0
        } else {
            constraint.unwrap_or(maximum)
        };
        let mut lines = Lines::default();
        let mut line_start = start;
        let mut line_end = start;
        for word in self.words(start, end)? {
            let word_start = word.start;
            let word_end = word.end;
            let candidate = self.range_width(line_start, word_end, basis, objects)?;
            if line_end > line_start
                && candidate > limit
                && candidate > self.range_width(line_start, line_end, basis, objects)?
            {
                self.append_line(&mut lines, line_start, line_end, basis, objects)?;
                line_start = word_start;
            }
            let emergency = self.overflow_wrap == "anywhere"
                || (self.overflow_wrap == "break-word" && !minimum);
            if emergency && self.range_width(word_start, word_end, basis, objects)? > limit {
                let source = self
                    .source
                    .get(word.clone())
                    .ok_or_else(|| unsupported("inline word boundary"))?;
                for (index, cluster) in source.grapheme_indices(true) {
                    let cluster_end = word_start
                        .saturating_add(index)
                        .saturating_add(cluster.len());
                    let cluster_start = word_start.saturating_add(index);
                    if cluster_start > line_start
                        && self.range_width(line_start, cluster_end, basis, objects)? > limit
                    {
                        self.append_line(&mut lines, line_start, cluster_start, basis, objects)?;
                        line_start = cluster_start;
                    }
                }
            }
            line_end = word_end;
        }
        self.append_line(&mut lines, line_start, line_end, basis, objects)?;
        Ok(lines)
    }
}
