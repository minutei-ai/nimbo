//! Resolve box lengths through the same inherited font/viewport context as CSS.
use std::borrow::Cow;

use lightningcss::{traits::Parse, values::length::Length};

use super::{Work, logical, unsupported};
use crate::{Result, fonts::Context};

pub(super) fn value<'a>(
    name: &str,
    value: &'a str,
    fonts: &Context,
    work: &mut Work<'_>,
) -> Result<Cow<'a, str>> {
    if !matches!(
        logical::group(name),
        Some("size" | "min-size" | "max-size" | "margin" | "padding" | "inset")
    ) && !matches!(name, "flex-basis" | "row-gap" | "column-gap")
    {
        return Ok(Cow::Borrowed(value));
    }
    if value == "0" {
        return Ok(Cow::Borrowed("0px"));
    }
    let nonnegative = !matches!(logical::group(name), Some("margin" | "inset"));
    if !value.contains('(') && (value.ends_with("px") || value.ends_with('%')) {
        return Ok(Cow::Borrowed(if nonnegative && value.starts_with('-') {
            "0px"
        } else {
            value
        }));
    }
    if matches!(
        value,
        "auto" | "min-content" | "max-content" | "fit-content" | "stretch" | "content"
    ) {
        return Ok(Cow::Borrowed(value));
    }
    if let Some(inner) = value
        .strip_prefix("fit-content(")
        .and_then(|v| v.strip_suffix(')'))
    {
        let inner = self::value(name, inner, fonts, work)?;
        return Ok(Cow::Owned(format!("fit-content({inner})")));
    }
    let parsed = Length::parse_string(value).map_err(|_error| unsupported(name))?;
    let resolved = fonts.length(&parsed, work)?;
    Ok(Cow::Owned(crate::fonts::pixels(if nonnegative {
        resolved.max(0.0)
    } else {
        resolved
    })?))
}
