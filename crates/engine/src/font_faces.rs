use std::collections::BTreeMap;

use cssparser::{Parser, ParserInput};
use lightningcss::{
    properties::font::{FontFamily, FontStretch, FontWeight},
    rules::{
        CssRule,
        font_face::{FontFaceProperty, FontStyle, Source, UnicodeRange},
    },
    stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
    traits::{Parse, ToCss},
    values::size::Size2D,
};
use rquickjs::{Ctx, Exception, Function};
use serde::Serialize;

use crate::{Error, Result};

#[derive(Serialize)]
pub(crate) struct Definition {
    pub owner: String,
    pub ordinal: usize,
    pub base: String,
    pub family: String,
    pub source: String,
    pub descriptors: BTreeMap<String, String>,
}

#[derive(Default)]
pub(crate) struct Definitions {
    pub values: Vec<Definition>,
    attempts: usize,
    owner: String,
    base: String,
    ordinal: usize,
}

#[derive(Serialize)]
struct Resource {
    url: Option<String>,
    format: Option<String>,
    technology: bool,
}

fn guarded(source: &str) -> bool {
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    crate::styles::components(&mut parser, 0, true).is_ok()
}

fn parse_resources(source: &str) -> Option<Vec<Resource>> {
    if !guarded(source) {
        return None;
    }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let sources = parser.parse_comma_separated(Source::parse).ok()?;
    parser.expect_exhausted().ok()?;
    sources
        .into_iter()
        .map(|source| {
            Some(match source {
                Source::Local(_) => Resource {
                    url: None,
                    format: None,
                    technology: false,
                },
                Source::Url(source) => Resource {
                    url: Some(source.url.url.to_string()),
                    format: source
                        .format
                        .map(|format| format.to_css_string(PrinterOptions::default()))
                        .transpose()
                        .ok()?,
                    technology: !source.tech.is_empty(),
                },
            })
        })
        .collect()
}

fn resources(source: &str) -> std::result::Result<Option<Vec<Resource>>, &'static str> {
    let parsed = parse_resources(source);
    if parsed.as_ref().is_some_and(|values| values.len() > 32) {
        return Err("font source limit");
    }
    Ok(parsed)
}

fn css<T: ToCss>(value: &T) -> Option<String> {
    value.to_css_string(PrinterOptions::default()).ok()
}

fn descriptor(name: &str, source: &str) -> Option<String> {
    if !guarded(source) {
        return None;
    }
    match name {
        "style" => css(&FontStyle::parse_string(source).ok()?),
        "weight" => css(&Size2D::<FontWeight>::parse_string(source).ok()?),
        "stretch" => css(&Size2D::<FontStretch>::parse_string(source).ok()?),
        "unicodeRange" => {
            let ranges = Vec::<UnicodeRange>::parse_string(source).ok()?;
            Some(
                ranges
                    .iter()
                    .map(css)
                    .collect::<Option<Vec<_>>>()?
                    .join(", "),
            )
        }
        "display" => {
            let mut input = ParserInput::new(source);
            let mut parser = Parser::new(&mut input);
            let value = parser.expect_ident_cloned().ok()?.to_ascii_lowercase();
            parser.expect_exhausted().ok()?;
            matches!(
                value.as_str(),
                "auto" | "block" | "swap" | "fallback" | "optional"
            )
            .then_some(value)
        }
        _ => None,
    }
}

fn field(name: &str) -> Option<&'static str> {
    match name {
        "font-style" => Some("style"),
        "font-weight" => Some("weight"),
        "font-stretch" => Some("stretch"),
        "unicode-range" => Some("unicodeRange"),
        "font-display" => Some("display"),
        "font-feature-settings" => Some("featureSettings"),
        "font-variation-settings" => Some("variationSettings"),
        "font-variant" => Some("variant"),
        "ascent-override" => Some("ascentOverride"),
        "descent-override" => Some("descentOverride"),
        "line-gap-override" => Some("lineGapOverride"),
        "size-adjust" => Some("sizeAdjust"),
        _ => None,
    }
}

impl Definitions {
    pub(crate) fn sheet(&mut self, owner: String, base: String) {
        self.owner = owner;
        self.base = base;
        self.ordinal = 0;
    }
    pub(crate) fn register(&mut self, body: &str) -> Result<()> {
        self.attempts = self.attempts.saturating_add(1);
        self.ordinal = self.ordinal.saturating_add(1);
        if self.attempts > 1024 {
            return Err(Error::Limit("font-face definitions"));
        }
        let source = format!("@font-face{{{body}}}");
        let Ok(sheet) = StyleSheet::parse(
            &source,
            ParserOptions {
                error_recovery: true,
                ..ParserOptions::default()
            },
        ) else {
            return Ok(());
        };
        let Some(CssRule::FontFace(rule)) = sheet.rules.0.first() else {
            return Ok(());
        };
        let mut family = None;
        let mut source = None;
        let mut descriptors = BTreeMap::new();
        for property in &rule.properties {
            match property {
                FontFaceProperty::FontFamily(value) if !matches!(value, FontFamily::Generic(_)) => {
                    family = css(value);
                }
                FontFaceProperty::Source(values) => {
                    source = values
                        .iter()
                        .map(css)
                        .collect::<Option<Vec<_>>>()
                        .map(|values| values.join(", "));
                }
                _ => {
                    if let Some(serialized) = css(property)
                        && let Some((name, value)) = serialized.split_once(':')
                        && let Some(name) = field(name.trim())
                        && let Some(value) = descriptor(name, value.trim()).or_else(|| {
                            (!matches!(
                                name,
                                "style" | "weight" | "stretch" | "unicodeRange" | "display"
                            ))
                            .then(|| value.trim().to_owned())
                        })
                    {
                        descriptors.insert(name.to_owned(), value);
                    }
                }
            }
        }
        if let (Some(family), Some(source)) = (family, source) {
            self.values.push(Definition {
                owner: self.owner.clone(),
                ordinal: self.ordinal,
                base: self.base.clone(),
                family,
                source,
                descriptors,
            });
        }
        Ok(())
    }
}

pub(crate) fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "nimboFontMeta",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'_>, field: String, source: String| {
                if source.len() > 4096 {
                    return Err(Exception::throw_message(&ctx, "font metadata limit"));
                }
                let value = if field == "source" {
                    serde_json::to_string(
                        &resources(&source)
                            .map_err(|message| Exception::throw_message(&ctx, message))?,
                    )
                } else {
                    serde_json::to_string(&descriptor(&field, &source))
                };
                value.map_err(|error| Exception::throw_message(&ctx, &error.to_string()))
            },
        )?,
    )
}
