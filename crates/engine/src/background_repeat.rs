//! Native repeat axes per image layer; tiling and painting are separate capabilities.
use crate::{Error, Result, layout::Work, styles::Declarations};
use lightningcss::{
    properties::{Property, PropertyId, background::BackgroundRepeat},
    stylesheet::{ParserOptions, PrinterOptions},
    traits::ToCss,
};

#[derive(Clone)]
pub(crate) struct Repeats {
    layers: Vec<BackgroundRepeat>,
}

impl Default for Repeats {
    fn default() -> Self {
        Self {
            layers: vec![BackgroundRepeat::default()],
        }
    }
}

impl Repeats {
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        count: usize,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let (value, _) = declarations.value("background-repeat");
        let computed: Result<Self> = match value.as_str() {
            "inherit" => {
                for _layer in &self.layers {
                    work.charge()?;
                }
                Ok(self.clone())
            }
            "" | "initial" | "unset" | "revert" => Ok(Self::default()),
            _ => {
                let Property::BackgroundRepeat(layers) = Property::parse_string(
                    PropertyId::BackgroundRepeat,
                    &value,
                    ParserOptions::default(),
                )
                .map_err(|_error| unsupported())?
                else {
                    return Err(unsupported());
                };
                for _layer in &layers {
                    work.charge()?;
                }
                Ok(Self {
                    layers: layers.into_iter().collect(),
                })
            }
        };
        let mut computed = computed?;
        computed.layers.truncate(count);
        Ok(computed)
    }

    pub(crate) fn value(&self, count: usize) -> Result<String> {
        let mut values = Vec::new();
        let mut bytes = 0_usize;
        for layer in self.layers.iter().cycle().take(count) {
            let value = layer
                .to_css_string(PrinterOptions::default())
                .map_err(|_error| unsupported())?;
            bytes = bytes.saturating_add(value.len()).saturating_add(2);
            if bytes > 2 * 1024 * 1024 {
                return Err(Error::Limit("computed background repeat bytes"));
            }
            values.push(value);
        }
        Ok(values.join(", "))
    }
}

fn unsupported() -> Error {
    Error::Dom("layout unsupported: background repeat syntax".into())
}
