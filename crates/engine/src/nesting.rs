use std::fmt::{self, Write};

use lightningcss::{
    error::PrinterErrorKind,
    printer::Printer,
    rules::CssRule,
    stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
    targets::{Features, Targets},
    traits::ToCss,
};

use crate::{Error, Result};

struct Output {
    text: String,
    limit: usize,
}

impl Write for Output {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        if self.text.len().saturating_add(value.len()) > self.limit {
            return Err(fmt::Error);
        }
        self.text.push_str(value);
        Ok(())
    }
}

pub(crate) fn lower(source: &str, limit: usize, flattened: bool) -> Result<Option<String>> {
    let sheet = StyleSheet::parse(
        source,
        ParserOptions {
            error_recovery: true,
            ..ParserOptions::default()
        },
    )
    .map_err(|error| Error::Dom(format!("stylesheet nesting: {error}")))?;
    if !sheet
        .rules
        .0
        .iter()
        .any(|rule| matches!(rule, CssRule::Style(style) if !style.rules.0.is_empty()))
    {
        return Ok(None);
    }
    if flattened {
        return Err(Error::Unsupported(
            "layout unsupported: nested stylesheet rule".into(),
        ));
    }
    let mut output = Output {
        text: String::new(),
        limit,
    };
    sheet
        .rules
        .to_css(&mut Printer::new(
            &mut output,
            PrinterOptions {
                targets: Targets {
                    include: Features::Nesting,
                    ..Targets::default()
                },
                ..PrinterOptions::default()
            },
        ))
        .map_err(|error| match &error.kind {
            PrinterErrorKind::FmtError => Error::Limit("stylesheet nesting output bytes"),
            _ => Error::Dom(format!("stylesheet nesting: {error}")),
        })?;
    Ok(Some(output.text))
}
