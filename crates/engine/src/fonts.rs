//! Computed font-size and contextual CSS lengths, independent of glyph shaping.
use crate::{Error, MediaEnvironment, Result, layout::Work, styles::Declarations};
use lightningcss::{
    properties::font::{AbsoluteFontSize, FontSize},
    traits::Parse,
    values::{
        calc::{Calc, MathFunction},
        length::{Length, LengthPercentage, LengthValue},
    },
};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Context {
    size: f64,
    adjustment: crate::text_adjust::Adjustment,
    tabs: crate::tabs::Tabs,
    line_height: crate::line_height::Height,
    root: f64,
    initial: f64,
    width: f64,
    height: f64,
}
impl Context {
    pub(crate) fn line_height(&self) -> Result<String> {
        self.line_height.value(self)
    }
    pub(crate) fn tabs(&self) -> Result<String> {
        self.tabs.value()
    }
    pub(crate) fn adjustment(&self) -> Result<String> {
        self.adjustment.value()
    }
    pub(crate) fn size(&self) -> f64 {
        self.size
    }
    pub(crate) fn new(media: &MediaEnvironment) -> Self {
        let size = f64::from(media.default_font_size);
        Self {
            size,
            adjustment: crate::text_adjust::Adjustment::default(),
            tabs: crate::tabs::Tabs::default(),
            line_height: crate::line_height::Height::default(),
            root: size,
            initial: size,
            width: f64::from(media.width),
            height: f64::from(media.height),
        }
    }
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        root: bool,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let (value, _) = declarations.value("font-size");
        let size = match value.as_str() {
            "" | "inherit" | "unset" => self.size,
            "initial" | "medium" => self.initial,
            _ => {
                let value =
                    FontSize::parse_string(&value).map_err(|_error| unsupported("font-size"))?;
                match value {
                    FontSize::Length(value) => {
                        self.percentage_length(&value, self.size, 0, work)?
                    }
                    FontSize::Absolute(AbsoluteFontSize::Medium) => self.initial,
                    _ => return Err(unsupported("font-size keyword")),
                }
            }
        };
        if !size.is_finite() || size < 0.0 {
            return Err(unsupported("non-finite font-size"));
        }
        let (value, _) = declarations.value("text-size-adjust");
        if !value.is_empty() {
            work.charge()?;
        }
        let adjustment = self.adjustment.compute(&value)?;
        let mut computed = Self {
            adjustment,
            size,
            root: if root { size } else { self.root },
            ..*self
        };
        let (value, _) = declarations.value("tab-size");
        if !value.is_empty() {
            work.charge()?;
        }
        computed.tabs = self.tabs.compute(&value, &computed, work)?;
        let (value, _) = declarations.value("line-height");
        if !value.is_empty() {
            work.charge()?;
        }
        computed.line_height = self.line_height.compute(&value, &computed, work)?;
        Ok(computed)
    }
    pub(crate) fn relative_length(
        &self,
        value: &LengthPercentage,
        work: &mut Work<'_>,
    ) -> Result<f64> {
        self.box_length(value, self.size, work)
    }
    pub(crate) fn box_length(
        &self,
        value: &LengthPercentage,
        basis: f64,
        work: &mut Work<'_>,
    ) -> Result<f64> {
        let value = self.percentage_length(value, basis, 0, work)?;
        if !value.is_finite() {
            return Err(unsupported("non-finite contextual length"));
        }
        Ok(value)
    }
    fn percentage_length(
        &self,
        value: &LengthPercentage,
        basis: f64,
        depth: usize,
        work: &mut Work<'_>,
    ) -> Result<f64> {
        match value {
            LengthPercentage::Dimension(value) => self.unit(value),
            LengthPercentage::Percentage(value) => Ok(f64::from(value.0) * basis),
            LengthPercentage::Calc(value) => {
                calculate(value, depth, work, &|value, depth, work| {
                    self.percentage_length(value, basis, depth, work)
                })
            }
        }
    }
    pub(crate) fn length(&self, value: &Length, work: &mut Work<'_>) -> Result<f64> {
        let value = self.nested_length(value, 0, work)?;
        if !value.is_finite() {
            return Err(unsupported("non-finite contextual length"));
        }
        Ok(value)
    }
    fn nested_length(&self, value: &Length, depth: usize, work: &mut Work<'_>) -> Result<f64> {
        match value {
            Length::Value(value) => self.unit(value),
            Length::Calc(value) => calculate(value, depth, work, &|value, depth, work| {
                self.nested_length(value, depth, work)
            }),
        }
    }
    fn unit(&self, value: &LengthValue) -> Result<f64> {
        if let Some(value) = value.to_px() {
            return Ok(f64::from(value));
        }
        let (value, unit) = value.to_unit_value();
        let basis = match unit {
            "em" => self.size,
            "rem" => self.root,
            "vw" | "vi" | "svw" | "svi" | "lvw" | "lvi" | "dvw" | "dvi" => self.width / 100.0,
            "vh" | "vb" | "svh" | "svb" | "lvh" | "lvb" | "dvh" | "dvb" => self.height / 100.0,
            "vmin" | "svmin" | "lvmin" | "dvmin" => self.width.min(self.height) / 100.0,
            "vmax" | "svmax" | "lvmax" | "dvmax" => self.width.max(self.height) / 100.0,
            _ => return Err(unsupported("relative query length")),
        };
        Ok(f64::from(value) * basis)
    }
}

fn calculate<V>(
    value: &Calc<V>,
    depth: usize,
    work: &mut Work<'_>,
    literal: &impl Fn(&V, usize, &mut Work<'_>) -> Result<f64>,
) -> Result<f64> {
    work.charge()?;
    if depth > 32 {
        return Err(Error::Limit("contextual length nesting"));
    }
    let next = depth.saturating_add(1);
    let eval = |value: &Calc<V>, work: &mut Work<'_>| calculate(value, next, work, literal);
    let value = match value {
        Calc::Value(value) => literal(value, next, work)?,
        Calc::Number(value) => f64::from(*value),
        Calc::Sum(a, b) => eval(a, work)? + eval(b, work)?,
        Calc::Product(factor, value) => f64::from(*factor) * eval(value, work)?,
        Calc::Function(function) => match function.as_ref() {
            MathFunction::Calc(value) => eval(value, work)?,
            MathFunction::Min(values) | MathFunction::Max(values) => {
                let mut result: Option<f64> = None;
                for value in values {
                    let value = eval(value, work)?;
                    result = Some(result.map_or(value, |current| {
                        if matches!(function.as_ref(), MathFunction::Min(_)) {
                            current.min(value)
                        } else {
                            current.max(value)
                        }
                    }));
                }
                result.ok_or_else(|| unsupported("empty math function"))?
            }
            MathFunction::Clamp(min, value, max) => {
                eval(min, work)?.max(eval(value, work)?.min(eval(max, work)?))
            }
            _ => return Err(unsupported("contextual math function")),
        },
    };
    if !value.is_finite() {
        return Err(unsupported("non-finite contextual length"));
    }
    Ok(value)
}

pub(crate) fn validate(value: &Length) -> Result<()> {
    let mut operations = 0;
    let mut work = Work::new(&mut operations, 1024, 1024);
    Context::new(&MediaEnvironment::default())
        .length(value, &mut work)
        .map(|_value| ())
}

pub(crate) fn absolute(value: &Length, work: &mut Work<'_>) -> Result<f64> {
    fn literal(value: &Length, depth: usize, work: &mut Work<'_>) -> Result<f64> {
        match value {
            Length::Value(value) => {
                if let Some(value) = value.to_px() {
                    return Ok(f64::from(value));
                }
                let (_value, unit) = value.to_unit_value();
                Err(unsupported(
                    if matches!(
                        unit,
                        "em" | "rem"
                            | "ex"
                            | "rex"
                            | "ch"
                            | "rch"
                            | "cap"
                            | "rcap"
                            | "ic"
                            | "ric"
                            | "lh"
                            | "rlh"
                    ) {
                        "registered relative length"
                    } else {
                        "registered contextual length"
                    },
                ))
            }
            Length::Calc(value) => calculate(value, depth, work, &literal),
        }
    }
    literal(value, 0, work)
}

pub(crate) fn pixels(value: f64) -> Result<String> {
    let rounded = format!("{value:.5e}")
        .parse::<f64>()
        .map_err(|_error| Error::Dom("computed length serialization".into()))?;
    if !rounded.is_finite() {
        return Err(Error::Dom("computed length range".into()));
    }
    Ok(format!("{rounded}px"))
}
