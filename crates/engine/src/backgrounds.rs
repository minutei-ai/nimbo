//! Native background image layers. Image painting is a separate capability.
use lightningcss::{
    properties::{Property, PropertyId},
    stylesheet::{ParserOptions, PrinterOptions},
    traits::ToCss,
    values::{
        color::CssColor,
        gradient::{Gradient, GradientItem, LineDirection},
        image::Image,
        length::LengthPercentage,
    },
};

use crate::{Error, Result, fonts::Context, layout::Work, styles::Declarations};

fn unsupported(detail: &str) -> Error {
    Error::Dom(format!("layout unsupported: background image {detail}"))
}

pub(crate) fn specified(value: &str) -> Option<String> {
    let parsed =
        Property::parse_string(PropertyId::BackgroundImage, value, ParserOptions::default())
            .ok()?;
    matches!(parsed, Property::BackgroundImage(_)).then(|| value.trim().to_owned())
}

#[derive(Clone)]
enum Item {
    Stop(CssColor, Option<String>),
    Hint(String),
}

#[derive(Clone)]
enum Layer {
    None,
    Linear {
        name: &'static str,
        direction: String,
        items: Vec<Item>,
    },
}

#[derive(Clone)]
pub(crate) struct Images {
    layers: Vec<Layer>,
    failure: Option<String>,
}

impl Default for Images {
    fn default() -> Self {
        Self {
            layers: vec![Layer::None],
            failure: None,
        }
    }
}

fn css(value: &impl ToCss) -> Result<String> {
    value
        .to_css_string(PrinterOptions::default())
        .map_err(|_error| unsupported("serialization"))
}

fn position(value: &LengthPercentage, fonts: &Context, work: &mut Work<'_>) -> Result<String> {
    let finite = match value {
        LengthPercentage::Percentage(value) => value.0.is_finite(),
        LengthPercentage::Dimension(value) => value.to_unit_value().0.is_finite(),
        LengthPercentage::Calc(_) => true,
    };
    if !finite {
        return Err(unsupported("non-finite position"));
    }
    match value {
        LengthPercentage::Percentage(value) => css(value),
        LengthPercentage::Dimension(length) if length.to_px().is_some() => {
            if length.to_unit_value().0 == 0.0 {
                Ok("0px".into())
            } else {
                css(length)
            }
        }
        LengthPercentage::Dimension(_) => crate::fonts::pixels(fonts.relative_length(value, work)?),
        LengthPercentage::Calc(_) => Err(unsupported("mixed percentage calculation")),
    }
}

fn direction(value: &LineDirection) -> Result<String> {
    use lightningcss::values::position::VerticalPositionKeyword;
    match value {
        LineDirection::Vertical(VerticalPositionKeyword::Bottom) => Ok(String::new()),
        LineDirection::Vertical(value) => Ok(format!("to {}", css(value)?)),
        LineDirection::Horizontal(value) => Ok(format!("to {}", css(value)?)),
        LineDirection::Corner {
            horizontal,
            vertical,
        } => Ok(format!("to {} {}", css(horizontal)?, css(vertical)?)),
        LineDirection::Angle(value) => {
            let degrees = f64::from(value.to_degrees());
            if !degrees.is_finite() {
                return Err(unsupported("non-finite angle"));
            }
            Ok(format!(
                "{}deg",
                crate::fonts::pixels(degrees)?.trim_end_matches("px")
            ))
        }
    }
}

fn layer(image: Image<'_>, fonts: &Context, work: &mut Work<'_>) -> Result<Layer> {
    work.charge()?;
    let Image::Gradient(gradient) = image else {
        return match image {
            Image::None => Ok(Layer::None),
            Image::Url(_) => Err(unsupported("URL provenance and loading")),
            Image::ImageSet(_) => Err(unsupported("image-set selection")),
            Image::Gradient(_) => Err(unsupported("gradient")),
        };
    };
    let (name, gradient) = match *gradient {
        Gradient::Linear(value) => ("linear-gradient", value),
        Gradient::RepeatingLinear(value) => ("repeating-linear-gradient", value),
        _ => return Err(unsupported("radial, conic or legacy gradient")),
    };
    if gradient.vendor_prefix != lightningcss::vendor_prefix::VendorPrefix::None {
        return Err(unsupported("legacy gradient direction"));
    }
    let direction = direction(&gradient.direction)?;
    let items = gradient
        .items
        .into_iter()
        .map(|item| {
            work.charge()?;
            match item {
                GradientItem::ColorStop(stop) => Ok(Item::Stop(
                    stop.color,
                    stop.position
                        .as_ref()
                        .map(|value| position(value, fonts, work))
                        .transpose()?,
                )),
                GradientItem::Hint(value) => Ok(Item::Hint(position(&value, fonts, work)?)),
            }
        })
        .collect::<Result<_>>()?;
    Ok(Layer::Linear {
        name,
        direction,
        items,
    })
}

impl Images {
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let (value, _) = declarations.value("background-image");
        match value.as_str() {
            "inherit" => Ok(self.clone()),
            "" | "initial" | "unset" => Ok(Self::default()),
            _ => {
                let Property::BackgroundImage(images) = Property::parse_string(
                    PropertyId::BackgroundImage,
                    &value,
                    ParserOptions::default(),
                )
                .map_err(|_error| unsupported("syntax"))?
                else {
                    return Err(unsupported("syntax"));
                };
                let layers = images
                    .into_iter()
                    .map(|image| layer(image, fonts, work))
                    .collect::<Result<Vec<_>>>();
                match layers {
                    Ok(layers) => Ok(Self {
                        layers,
                        failure: None,
                    }),
                    Err(Error::Dom(message)) if message.starts_with("layout unsupported:") => {
                        Ok(Self {
                            layers: Vec::new(),
                            failure: Some(message),
                        })
                    }
                    Err(error) => Err(error),
                }
            }
        }
    }

    pub(crate) fn validate(&self) -> Result<()> {
        self.failure
            .as_ref()
            .map_or(Ok(()), |message| Err(Error::Dom(message.clone())))
    }

    pub(crate) fn value(&self, current: &CssColor) -> Result<String> {
        self.validate()?;
        self.layers
            .iter()
            .map(|layer| match layer {
                Layer::None => Ok("none".into()),
                Layer::Linear {
                    name,
                    direction,
                    items,
                } => {
                    let mut values = Vec::new();
                    if !direction.is_empty() {
                        values.push(direction.clone());
                    }
                    for item in items {
                        values.push(match item {
                            Item::Hint(value) => value.clone(),
                            Item::Stop(color, position) => {
                                let color = if matches!(color, CssColor::CurrentColor) {
                                    current
                                } else {
                                    color
                                };
                                let mut value = crate::outlines::serialize_color(color)?;
                                if let Some(position) = position {
                                    value.push(' ');
                                    value.push_str(position);
                                }
                                value
                            }
                        });
                    }
                    Ok(format!("{name}({})", values.join(", ")))
                }
            })
            .collect::<Result<Vec<_>>>()
            .map(|values| values.join(", "))
    }
}
