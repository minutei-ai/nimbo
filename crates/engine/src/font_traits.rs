use crate::{Error, Result, styles::Declarations};
use lightningcss::{
    properties::{
        Property,
        font::{AbsoluteFontWeight, FontStyle, FontWeight},
    },
    traits::Parse,
    values::{angle::Angle, number::CSSNumber},
};

fn absolute(value: &AbsoluteFontWeight) -> CSSNumber {
    match value {
        AbsoluteFontWeight::Normal => 400.0,
        AbsoluteFontWeight::Bold => 700.0,
        AbsoluteFontWeight::Weight(value) => *value,
    }
}
fn valid_weight(value: &FontWeight) -> bool {
    match value {
        FontWeight::Absolute(value) => (1.0..=1000.0).contains(&absolute(value)),
        FontWeight::Bolder | FontWeight::Lighter => true,
    }
}
fn valid_style(value: &FontStyle) -> bool {
    match value {
        FontStyle::Normal | FontStyle::Italic => true,
        FontStyle::Oblique(angle) => (-90.0..=90.0).contains(&angle.to_degrees()),
    }
}
pub(crate) fn valid(value: &Property<'_>) -> bool {
    match value {
        Property::FontWeight(value) => valid_weight(value),
        Property::FontStyle(value) => valid_style(value),
        Property::Font(value) => valid_weight(&value.weight) && valid_style(&value.style),
        _ => true,
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct Computed {
    pub(crate) weight: CSSNumber,
    pub(crate) style: FontStyle,
}
impl Default for Computed {
    fn default() -> Self {
        Self {
            weight: 400.0,
            style: FontStyle::Normal,
        }
    }
}
impl Computed {
    pub(crate) fn compute(&self, declarations: &Declarations) -> Result<Self> {
        let (weight, _) = declarations.value("font-weight");
        let weight = match weight.as_str() {
            "" | "inherit" | "unset" | "revert" => self.weight,
            "initial" => 400.0,
            _ => match FontWeight::parse_string(&weight)
                .map_err(|_error| Error::Dom("layout unsupported: font-weight".into()))?
            {
                FontWeight::Absolute(value) => absolute(&value),
                FontWeight::Bolder => {
                    if self.weight < 350.0 {
                        400.0
                    } else if self.weight < 550.0 {
                        700.0
                    } else {
                        self.weight.max(900.0)
                    }
                }
                FontWeight::Lighter => {
                    if self.weight < 550.0 {
                        self.weight.min(100.0)
                    } else if self.weight < 750.0 {
                        400.0
                    } else {
                        700.0
                    }
                }
            },
        };
        let (style, _) = declarations.value("font-style");
        let style = match style.as_str() {
            "" | "inherit" | "unset" | "revert" => self.style.clone(),
            "initial" => FontStyle::Normal,
            _ => FontStyle::parse_string(&style)
                .map_err(|_error| Error::Dom("layout unsupported: font-style".into()))?,
        };
        let style = match style {
            FontStyle::Oblique(angle) => FontStyle::Oblique(Angle::Deg(angle.to_degrees())),
            value => value,
        };
        Ok(Self { weight, style })
    }
}
