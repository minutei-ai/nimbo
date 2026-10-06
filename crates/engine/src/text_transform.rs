//! Inherited Unicode casing of rendered text, without mutating DOM source.
use crate::{Result, styles::Declarations};

#[derive(Clone, Copy, Default)]
pub(crate) enum Transform {
    #[default]
    None,
    Uppercase,
    Lowercase,
}
impl Transform {
    pub(crate) fn compute(self, declarations: &Declarations) -> Result<Self> {
        let (value, _) = declarations.value("text-transform");
        match value.as_str() {
            "" | "inherit" | "unset" | "revert" => Ok(self),
            "none" | "initial" => Ok(Self::None),
            "uppercase" => Ok(Self::Uppercase),
            "lowercase" => Ok(Self::Lowercase),
            _ => Err(crate::Error::Dom(
                "layout unsupported: text-transform".into(),
            )),
        }
    }
    pub(crate) fn value(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Uppercase => "uppercase",
            Self::Lowercase => "lowercase",
        }
    }
    pub(crate) fn apply(self, source: &str, language: &str) -> Result<String> {
        let language = language
            .parse()
            .map_err(|_error| crate::Error::Dom("invalid text language".into()))?;
        let mapper = icu_casemap::CaseMapper::new();
        Ok(match self {
            Self::None => source.to_owned(),
            Self::Uppercase => mapper.uppercase_to_string(source, &language).into_owned(),
            Self::Lowercase => mapper.lowercase_to_string(source, &language).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Transform;
    #[test]
    fn full_unicode_casing_preserves_context_and_language() -> crate::Result<()> {
        assert_eq!(
            Transform::Uppercase.apply("straße café", "de")?,
            "STRASSE CAFÉ"
        );
        assert_eq!(Transform::Lowercase.apply("ΟΣ ΟΣΑ", "und")?, "ος οσα");
        assert_eq!(
            Transform::Uppercase.apply("istanbul izin", "tr")?,
            "İSTANBUL İZİN"
        );
        assert_eq!(Transform::Lowercase.apply("Iİ I", "tr")?, "ıi ı");
        Ok(())
    }
}
