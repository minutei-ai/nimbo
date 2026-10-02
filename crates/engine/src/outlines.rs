//! Native outline values; outlines do not participate in box dimensions.
use lightningcss::{
    properties::{border::BorderSideWidth, outline::OutlineStyle},
    stylesheet::PrinterOptions,
    traits::{Parse, ToCss},
    values::{
        color::{CssColor, RGBA},
        length::Length,
    },
};

use crate::{Error, Result, fonts::Context, layout::Work, styles::Declarations};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: {detail}"))
}

pub(crate) fn property(name: &str) -> bool {
    matches!(
        name,
        "outline-color" | "outline-style" | "outline-width" | "outline-offset"
    )
}

pub(crate) fn valid(property: &lightningcss::properties::Property<'_>) -> bool {
    use lightningcss::properties::{Property, border::LineStyle};
    !matches!(
        property,
        Property::OutlineStyle(OutlineStyle::LineStyle(LineStyle::Hidden))
    ) && !matches!(property, Property::Outline(outline) if matches!(outline.style, OutlineStyle::LineStyle(LineStyle::Hidden)))
}

#[derive(Clone)]
pub(crate) struct Outlines {
    color: CssColor,
    outline_color: CssColor,
    width: f64,
    offset: f64,
    style: String,
}

impl Default for Outlines {
    fn default() -> Self {
        let color = CssColor::RGBA(RGBA {
            red: 0,
            green: 0,
            blue: 0,
            alpha: 255,
        });
        Self {
            color: color.clone(),
            outline_color: color,
            width: 3.0,
            offset: 0.0,
            style: "none".into(),
        }
    }
}

fn color(
    value: &str,
    inherited: &CssColor,
    current: &CssColor,
    initial: &CssColor,
) -> Result<CssColor> {
    match value {
        "inherit" => Ok(inherited.clone()),
        "" | "initial" | "unset" | "auto" => Ok(initial.clone()),
        _ => match CssColor::parse_string(value).map_err(|_error| unsupported("outline color"))? {
            CssColor::CurrentColor => Ok(current.clone()),
            value => Ok(value),
        },
    }
}

fn width(value: &str, inherited: f64, fonts: &Context, work: &mut Work<'_>) -> Result<f64> {
    if value == "inherit" {
        return Ok(inherited);
    }
    let width = match value {
        "" | "initial" | "unset" | "medium" => 3.0,
        "thin" => 1.0,
        "thick" => 5.0,
        _ => match BorderSideWidth::parse_string(value)
            .map_err(|_error| unsupported("outline width"))?
        {
            BorderSideWidth::Length(value) => fonts.length(&value, work)?.max(0.0),
            _ => return Err(unsupported("outline width")),
        },
    };
    Ok(if width <= 0.0 {
        0.0
    } else {
        width.floor().max(1.0)
    })
}

fn offset(value: &str, inherited: f64, fonts: &Context, work: &mut Work<'_>) -> Result<f64> {
    match value {
        "inherit" => Ok(inherited),
        "" | "initial" | "unset" => Ok(0.0),
        _ => fonts
            .length(
                &Length::parse_string(value).map_err(|_error| unsupported("outline offset"))?,
                work,
            )
            .map(f64::trunc),
    }
}

pub(crate) fn serialize_color(color: &CssColor) -> Result<String> {
    let CssColor::RGBA(value) = color else {
        return Err(unsupported("computed color space or context color"));
    };
    let RGBA {
        red,
        green,
        blue,
        alpha,
    } = value;
    if *alpha == 255 {
        return Ok(format!("rgb({red}, {green}, {blue})"));
    }
    let alpha = f64::from(*alpha) / 255.0;
    let short = (alpha * 100.0).round() / 100.0;
    let alpha = if (short * 255.0)
        .round()
        .total_cmp(&(alpha * 255.0).round())
        .is_eq()
    {
        short
    } else {
        (alpha * 1000.0).round() / 1000.0
    };
    Ok(format!("rgba({red}, {green}, {blue}, {alpha})"))
}

impl Outlines {
    pub(crate) fn color(&self) -> &CssColor {
        &self.color
    }

    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        for (name, _, _) in declarations.layout_entries() {
            if name == "color" || property(name) {
                work.charge()?;
            }
        }
        let initial = Self::default();
        let (value, _) = declarations.value("color");
        let current = match value.as_str() {
            "" | "inherit" | "unset" => self.color.clone(),
            _ => color(&value, &self.color, &self.color, &initial.color)?,
        };
        let (value, _) = declarations.value("outline-color");
        let outline_color = color(&value, &self.outline_color, &current, &current)?;
        let (value, _) = declarations.value("outline-style");
        let style = match value.as_str() {
            "inherit" => self.style.clone(),
            "" | "initial" | "unset" => "none".into(),
            _ => OutlineStyle::parse_string(&value)
                .map_err(|_error| unsupported("outline style"))?
                .to_css_string(PrinterOptions::default())
                .map_err(|_error| unsupported("outline style"))?,
        };
        let (value, _) = declarations.value("outline-width");
        let width = width(&value, self.width, fonts, work)?;
        let (value, _) = declarations.value("outline-offset");
        let offset = offset(&value, self.offset, fonts, work)?;
        Ok(Self {
            color: current,
            outline_color,
            style,
            width,
            offset,
        })
    }

    pub(crate) fn value(&self, name: &str, fonts: &Context) -> Result<String> {
        match name {
            "color" => serialize_color(&self.color),
            "outline-color" => serialize_color(&self.outline_color),
            "font-size" => Ok(format!("{}px", fonts.size())),
            "outline-style" => Ok(self.style.clone()),
            "outline-width" => Ok(format!("{}px", self.width)),
            "outline-offset" => Ok(format!("{}px", self.offset)),
            _ => Err(unsupported("computed style property")),
        }
    }
}
