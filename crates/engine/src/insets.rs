use crate::{
    Error, Result, fonts::Context, layout::Work, position_value::Value, styles::Declarations,
};

#[derive(Default)]
pub(crate) struct Insets([Option<Value>; 4]);

pub(crate) fn index(name: &str, rtl: bool) -> Option<usize> {
    match crate::layout::logical::physical_in(name, rtl) {
        "top" => Some(0),
        "right" => Some(1),
        "bottom" => Some(2),
        "left" => Some(3),
        _ => None,
    }
}

impl Insets {
    pub(crate) fn compute(
        &self,
        declarations: &Declarations,
        fonts: &Context,
        work: &mut Work<'_>,
    ) -> Result<Self> {
        let mut result = Self::default();
        for (name, value, _) in crate::layout::logical::entries(declarations, fonts.rtl()) {
            let Some(index) = index(name, false) else {
                continue;
            };
            *result
                .0
                .get_mut(index)
                .ok_or_else(|| Error::Dom("invalid inset side".into()))? = match value {
                "inherit" => self
                    .0
                    .get(index)
                    .cloned()
                    .ok_or_else(|| Error::Dom("invalid inset side".into()))?,
                "" | "initial" | "unset" | "revert" | "auto" => None,
                value => Some(Value::from_css(value, fonts, work, false)?),
            };
        }
        Ok(result)
    }

    pub(crate) fn value(
        &self,
        index: usize,
        position: &str,
        geometry: Option<&crate::layout::resolved::BoxValues>,
    ) -> Result<String> {
        let value = self
            .0
            .get(index)
            .ok_or_else(|| Error::Dom("invalid inset side".into()))?;
        let Some(geometry) = geometry else {
            return value
                .as_ref()
                .map_or_else(|| Ok("auto".into()), Value::value);
        };
        let basis = geometry.inset_basis(position, index);
        if let Some(value) = value {
            return crate::fonts::pixels(value.resolve(basis)?);
        }
        match position {
            "relative" => {
                let opposite = index.saturating_add(2) % 4;
                let value = self
                    .0
                    .get(opposite)
                    .and_then(Option::as_ref)
                    .map_or(Ok(0.0), |value| value.resolve(basis))?;
                if value == 0.0 {
                    Ok("0px".into())
                } else {
                    crate::fonts::pixels(-value)
                }
            }
            "absolute" | "fixed" => crate::fonts::pixels(geometry.inset_offset(index)?),
            _ => Ok("auto".into()),
        }
    }
}
