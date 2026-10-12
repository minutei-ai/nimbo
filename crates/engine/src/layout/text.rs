//! Native loaded-font advances, collapsed whitespace and greedy line breaking.
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};

use harfrust::Font;
use num_traits::ToPrimitive;
use taffy::prelude::*;
use unicode_segmentation::UnicodeSegmentation;

use super::{svg_viewport, unsupported};
use crate::{Result, dom_attributes::NativeAttributes, styles::Declarations};

#[derive(Clone, PartialEq)]
pub(super) struct Typography {
    weight: String,
    style: String,
    spacing: f64,
    stretch: String,
    variant: String,
    whitespace: String,
    overflow_wrap: String,
    transform: crate::text_transform::Transform,
    language: String,
}
impl Default for Typography {
    fn default() -> Self {
        Self {
            weight: "normal".into(),
            style: "normal".into(),
            spacing: 0.0,
            stretch: "normal".into(),
            variant: "normal".into(),
            whitespace: "normal".into(),
            overflow_wrap: "normal".into(),
            transform: crate::text_transform::Transform::default(),
            language: "und".into(),
        }
    }
}
impl Typography {
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
                self.style,
                self.weight,
                fonts.size(),
                family.value()?
            ),
            "0",
        )?;
        crate::font_data::measure(&font, "0", fonts.size()).map_err(unsupported)
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
            weight: inherited(declarations, "font-weight", &self.weight),
            style: inherited(declarations, "font-style", &self.style),
            spacing,
            stretch: inherited(declarations, "font-stretch", &self.stretch),
            variant: inherited(declarations, "font-variant", &self.variant),
            whitespace: inherited(declarations, "white-space", &self.whitespace),
            overflow_wrap: inherited(declarations, "overflow-wrap", &self.overflow_wrap),
        })
    }
}

#[derive(Default)]
pub(super) struct Budget {
    bytes: Cell<usize>,
    error: RefCell<Option<crate::Error>>,
}
impl Budget {
    pub(super) fn check(&self) -> Result<()> {
        self.error.borrow_mut().take().map_or(Ok(()), Err)
    }
    fn shape(&self, font: &Font, source: &str, size: f64, spacing: f64) -> Result<f64> {
        self.bytes
            .set(self.bytes.get().saturating_add(source.len().max(1)));
        if source.len() > 65_536 || self.bytes.get() > 1_048_576 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        crate::font_data::measure_spaced(font, source, size, spacing).map_err(unsupported)
    }
}

pub(super) enum Intrinsic {
    Replaced(svg_viewport::Intrinsic),
    Text(Run),
}
impl Intrinsic {
    pub(super) fn layout(&self, inputs: taffy::LayoutInput, style: &Style) -> taffy::LayoutOutput {
        use taffy::util::ResolveOrZero;
        let mut measured = None;
        let mut output = taffy::compute::compute_leaf_layout(
            inputs,
            style,
            |_, _| 0.0,
            |known, available| {
                let size = if let Self::Replaced(value) = self {
                    Self::replaced_size(value, known, available, inputs, style)
                } else {
                    self.measure(known, available)
                };
                measured = Some(size);
                size
            },
        );
        if let Self::Text(run) = self {
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
                self.measure(
                    Size {
                        width: Some((output.size.width - inset.horizontal_axis_sum()).max(0.0)),
                        height: None,
                    },
                    Size::MAX_CONTENT,
                )
            });
            let first = f64::from(inset.top) + run.baseline;
            let last = first + f64::from(size.height) - run.height;
            match (first.to_f32(), last.to_f32()) {
                (Some(first), Some(last)) if first.is_finite() && last.is_finite() => {
                    output.baselines = taffy::Baselines {
                        first: Some(first),
                        last: Some(last),
                    };
                }
                _ => *run.budget.error.borrow_mut() = Some(unsupported("text baseline range")),
            }
        }
        output
    }

    fn replaced_size(
        value: &svg_viewport::Intrinsic,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
        inputs: taffy::LayoutInput,
        style: &Style,
    ) -> Size<f32> {
        use taffy::util::{MaybeResolve, ResolveOrZero};
        let padding = style
            .padding
            .resolve_or_zero(inputs.parent_size.width, |_, _| 0.0)
            .sum_axes();
        let border = style
            .border
            .resolve_or_zero(inputs.parent_size.width, |_, _| 0.0)
            .sum_axes();
        let inset = Size {
            width: padding.width + border.width,
            height: padding.height + border.height,
        };
        let adjust = if style.box_sizing == BoxSizing::BorderBox {
            inset
        } else {
            Size::ZERO
        };
        let declared = style
            .size
            .maybe_resolve(inputs.parent_size, |_, _| 0.0)
            .zip_map(adjust, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            });
        let known = known
            .or(inputs.known_dimensions.zip_map(inset, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            }))
            .or(declared);
        let min = style
            .min_size
            .maybe_resolve(inputs.parent_size, |_, _| 0.0)
            .zip_map(adjust, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            });
        let max = style
            .max_size
            .maybe_resolve(inputs.parent_size, |_, _| 0.0)
            .zip_map(adjust, |value, inset| {
                value.map(|value| (value - inset).max(0.0))
            });
        let mut size = value.measure(known, available);
        size.width = size
            .width
            .min(max.width.unwrap_or(f32::INFINITY))
            .max(min.width.unwrap_or(0.0));
        if known.height.is_none() && style.aspect_ratio.is_some() {
            size.height = size.width / style.aspect_ratio.unwrap_or(1.0);
        }
        size.height = size
            .height
            .min(max.height.unwrap_or(f32::INFINITY))
            .max(min.height.unwrap_or(0.0));
        if known.width.is_none() && style.aspect_ratio.is_some() {
            size.width = size.height * style.aspect_ratio.unwrap_or(1.0);
        }
        size
    }
    pub(super) fn measure(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
    ) -> Size<f32> {
        match self {
            Self::Replaced(value) => value.measure(known, available),
            Self::Text(value) => match value.measure(known, available) {
                Ok(size) => size,
                Err(error) => {
                    if value.budget.error.borrow().is_none() {
                        *value.budget.error.borrow_mut() = Some(error);
                    }
                    // The scene checks this failure before exposing any geometry.
                    Size::ZERO
                }
            },
        }
    }
}

fn line_metrics(font: &Font, size: f64, height: &str) -> Result<(f64, f64)> {
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
    let height = if height == "normal" {
        ascent + descent + (line.line_gap.to_f64() * scale).max(0.0).round()
    } else {
        height
            .strip_suffix("px")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or_else(|| unsupported("text line metrics"))?
    };
    Ok((height, ascent + ((height - ascent - descent) / 2.0).floor()))
}

pub(super) struct Run {
    font: Font,
    source: String,
    size: f64,
    height: f64,
    baseline: f64,
    spacing: f64,
    nowrap: bool,
    overflow_wrap: String,
    budget: Rc<Budget>,
    advances: RefCell<HashMap<String, f64>>,
}
impl Run {
    pub(super) fn line_height(&self) -> f64 {
        self.height
    }
    pub(super) fn new(
        source: &str,
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
        Self::parse("", typography, context, fonts, budget, true)?
            .ok_or_else(|| unsupported("inline font strut"))
    }

    fn parse(
        source: &str,
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
        if !matches!(typography.style.as_str(), "normal" | "italic")
            || !matches!(typography.stretch.as_str(), "normal" | "100%")
            || typography.variant != "normal"
        {
            return Err(unsupported("text font synthesis or spacing"));
        }
        let normalized = normalize(source, typography.preserves_breaks());
        if normalized.is_empty() && !strut {
            return Ok(None);
        }
        if normalized.len() > 65_536 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        if !matches!(typography.transform, crate::text_transform::Transform::None) {
            budget
                .bytes
                .set(budget.bytes.get().saturating_add(normalized.len().max(1)));
        }
        if budget.bytes.get() > 1_048_576 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        let normalized = typography
            .transform
            .apply(&normalized, &typography.language)?;
        let size = context.fonts.size();
        let font = fonts.select(
            format!(
                "{} {} {size}px {}",
                typography.style,
                typography.weight,
                context.family.value()?
            ),
            &normalized,
        )?;
        let (height, baseline) = line_metrics(&font, size, &context.fonts.line_height()?)?;
        let mut advances = HashMap::new();
        for line in normalized.split('\n') {
            if !advances.contains_key(line) {
                advances.insert(
                    line.to_owned(),
                    budget.shape(&font, line, size, typography.spacing)?,
                );
            }
        }
        Ok(Some(Self {
            font,
            source: normalized,
            size,
            height,
            baseline,
            spacing: typography.spacing,
            nowrap: typography.whitespace == "nowrap",
            overflow_wrap: typography.overflow_wrap.clone(),
            budget,
            advances: RefCell::new(advances),
        }))
    }
    fn width(&self, source: &str) -> Result<f64> {
        if let Some(advance) = self.advances.borrow().get(source) {
            return Ok(*advance);
        }
        let advance = self
            .budget
            .shape(&self.font, source, self.size, self.spacing)?;
        self.advances
            .borrow_mut()
            .insert(source.to_owned(), advance);
        Ok(advance)
    }
    fn measure(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
    ) -> Result<Size<f32>> {
        let source = self.source.strip_suffix('\n').unwrap_or(&self.source);
        let mut width = 0.0_f64;
        let mut lines = 0_u32;
        for paragraph in source.split('\n') {
            let (paragraph_width, paragraph_lines) = self.paragraph(paragraph, known, available)?;
            width = width.max(paragraph_width);
            lines = lines
                .checked_add(paragraph_lines)
                .ok_or(crate::Error::Limit("text line count"))?;
        }
        let number = |value: f64| {
            value
                .to_f32()
                .filter(|value| value.is_finite())
                .ok_or_else(|| unsupported("text metric range"))
        };
        Ok(Size {
            width: number(width)?,
            height: number(self.height * f64::from(lines))?,
        })
    }
    fn paragraph(
        &self,
        source: &str,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
    ) -> Result<(f64, u32)> {
        let maximum = self.width(source)?;
        let constraint = known
            .width
            .map(f64::from)
            .or_else(|| match available.width {
                AvailableSpace::Definite(value) => Some(f64::from(value)),
                _ => None,
            });
        let minimum =
            matches!(available.width, AvailableSpace::MinContent) && known.width.is_none();
        let mut lines = 1_u32;
        let mut width = maximum;
        if !self.nowrap && (minimum || constraint.is_some_and(|limit| maximum > limit)) {
            width = 0.0;
            let mut line = String::new();
            let limit = if minimum {
                0.0
            } else {
                constraint.unwrap_or(maximum)
            };
            for word in source.split(' ') {
                let candidate = if line.is_empty() {
                    word.to_owned()
                } else {
                    format!("{line} {word}")
                };
                if !line.is_empty() && self.width(&candidate)? > limit {
                    width = width.max(self.width(&line)?);
                    lines = lines
                        .checked_add(1)
                        .ok_or(crate::Error::Limit("text line count"))?;
                    line.clear();
                }
                let emergency = self.overflow_wrap == "anywhere"
                    || (self.overflow_wrap == "break-word" && !minimum);
                if emergency && self.width(word)? > limit {
                    for cluster in word.graphemes(true) {
                        let candidate = format!("{line}{cluster}");
                        if !line.is_empty() && self.width(&candidate)? > limit {
                            width = width.max(self.width(&line)?);
                            lines = lines
                                .checked_add(1)
                                .ok_or(crate::Error::Limit("text line count"))?;
                            line.clear();
                        }
                        line.push_str(cluster);
                    }
                } else {
                    if !line.is_empty() {
                        line.push(' ');
                    }
                    line.push_str(word);
                }
            }
            width = width.max(self.width(&line)?);
        }
        Ok((width, lines))
    }
}

fn normalize(source: &str, preserve_breaks: bool) -> String {
    let collapse = |line: &str| {
        line.split([' ', '\t', '\n', '\r', '\u{c}'])
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };
    if preserve_breaks {
        source
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .split('\n')
            .map(collapse)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        collapse(source)
    }
}
