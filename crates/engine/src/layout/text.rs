//! Native loaded-font advances, collapsed whitespace and greedy line breaking.
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use harfrust::Font;
use num_traits::ToPrimitive;
use taffy::prelude::*;

use super::{svg_viewport, unsupported};
use crate::{Result, styles::Declarations};

#[derive(Clone)]
pub(super) struct Typography {
    weight: String,
    style: String,
    spacing: f64,
    stretch: String,
    variant: String,
    whitespace: String,
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
        }
    }
}
impl Typography {
    pub(super) fn compute(
        &self,
        declarations: &Declarations,
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
        Ok(Self {
            weight: inherited(declarations, "font-weight", &self.weight),
            style: inherited(declarations, "font-style", &self.style),
            spacing,
            stretch: inherited(declarations, "font-stretch", &self.stretch),
            variant: inherited(declarations, "font-variant", &self.variant),
            whitespace: inherited(declarations, "white-space", &self.whitespace),
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
        if source.len() > 1024 || self.bytes.get() > 1_048_576 {
            return Err(crate::Error::Limit("layout text shaping"));
        }
        crate::font_data::measure_spaced(font, source, size, spacing).map_err(unsupported)
    }
}

pub(super) enum Intrinsic {
    Svg(svg_viewport::Intrinsic),
    Text(Run),
}
impl Intrinsic {
    pub(super) fn measure(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
    ) -> Size<f32> {
        match self {
            Self::Svg(value) => value.measure(known, available),
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

pub(super) struct Run {
    font: Font,
    source: String,
    size: f64,
    height: f64,
    spacing: f64,
    nowrap: bool,
    budget: Rc<Budget>,
}
impl Run {
    pub(super) fn new(
        source: &str,
        typography: &Typography,
        context: &super::BoxContext,
        fonts: &crate::font_data::Arena,
        budget: Rc<Budget>,
    ) -> Result<Option<Self>> {
        if !matches!(typography.whitespace.as_str(), "normal" | "nowrap") {
            return Err(unsupported("text white-space"));
        }
        if !matches!(typography.style.as_str(), "normal" | "italic")
            || !matches!(typography.stretch.as_str(), "normal" | "100%")
            || typography.variant != "normal"
        {
            return Err(unsupported("text font synthesis or spacing"));
        }
        let mut normalized = String::new();
        for part in source
            .split([' ', '\t', '\n', '\r', '\u{c}'])
            .filter(|part| !part.is_empty())
        {
            if !normalized.is_empty() {
                normalized.push(' ');
            }
            normalized.push_str(part);
        }
        if normalized.is_empty() {
            return Ok(None);
        }
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
        let height = context.fonts.line_height()?;
        let height = if height == "normal" {
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
            let ascent = line.ascender.to_f64() * scale;
            let descent = -line.descender.to_f64() * scale;
            let gap = (line.line_gap.to_f64() * scale).max(0.0);
            ascent.round() + descent.round() + gap.round()
        } else {
            height
                .strip_suffix("px")
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value >= 0.0)
                .ok_or_else(|| unsupported("text line metrics"))?
        };
        budget.shape(&font, &normalized, size, typography.spacing)?;
        Ok(Some(Self {
            font,
            source: normalized,
            size,
            height,
            spacing: typography.spacing,
            nowrap: typography.whitespace == "nowrap",
            budget,
        }))
    }
    fn width(&self, source: &str) -> Result<f64> {
        self.budget
            .shape(&self.font, source, self.size, self.spacing)
    }
    fn measure(
        &self,
        known: Size<Option<f32>>,
        available: Size<AvailableSpace>,
    ) -> Result<Size<f32>> {
        let maximum = self.width(&self.source)?;
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
            for word in self.source.split(' ') {
                let candidate = if line.is_empty() {
                    word.to_owned()
                } else {
                    format!("{line} {word}")
                };
                let advance = self.width(&candidate)?;
                if !line.is_empty() && advance > limit {
                    width = width.max(self.width(&line)?);
                    lines = lines
                        .checked_add(1)
                        .ok_or(crate::Error::Limit("text line count"))?;
                    word.clone_into(&mut line);
                } else {
                    line = candidate;
                }
            }
            width = width.max(self.width(&line)?);
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
}
