use cssparser::{Parser, ParserInput};
use lightningcss::{
    rules::CssRule,
    stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
    traits::ToCss,
};

use crate::{Error, MediaEnvironment, Result};

#[derive(Clone)]
pub(crate) enum Layer {
    Unlayered,
    Anonymous,
    Named(Vec<String>),
}

#[derive(Clone)]
pub(crate) struct Import {
    pub url: String,
    pub media: String,
    pub supports: Option<String>,
    pub layer: Layer,
}

impl Import {
    pub(crate) fn enabled(&self, media: &MediaEnvironment) -> Result<bool> {
        if !media.matches(&self.media)? {
            return Ok(false);
        }
        if let Some(condition) = &self.supports {
            return crate::supports::query(condition);
        }
        Ok(true)
    }
}

pub(crate) fn parse(source: &str) -> Result<Vec<Import>> {
    let mut input = ParserInput::new(source);
    crate::css_syntax::consume(&mut Parser::new(&mut input), 0)
        .map_err(|_error| Error::Limit("stylesheet import nesting"))?;
    let sheet = StyleSheet::parse(
        source,
        ParserOptions {
            error_recovery: true,
            ..ParserOptions::default()
        },
    )
    .map_err(|error| Error::Dom(format!("stylesheet imports: {error}")))?;
    let mut imports = Vec::new();
    for rule in sheet.rules.0 {
        if let CssRule::Import(rule) = rule {
            if imports.len() >= 1024 {
                return Err(Error::Limit("stylesheet imports"));
            }
            imports.push(Import {
                url: rule.url.to_string(),
                media: if rule.media.always_matches() {
                    "all".to_owned()
                } else {
                    rule.media
                        .to_css_string(PrinterOptions::default())
                        .map_err(|error| Error::Dom(format!("stylesheet import media: {error}")))?
                },
                supports: rule
                    .supports
                    .map(|condition| condition.to_css_string(PrinterOptions::default()))
                    .transpose()
                    .map_err(|error| Error::Dom(format!("stylesheet import supports: {error}")))?,
                layer: match rule.layer {
                    None => Layer::Unlayered,
                    Some(None) => Layer::Anonymous,
                    Some(Some(name)) => {
                        Layer::Named(name.0.into_iter().map(|part| part.to_string()).collect())
                    }
                },
            });
        }
    }
    Ok(imports)
}
