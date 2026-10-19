use std::borrow::Cow;

use crate::{Error, Result};

pub(crate) fn content_type(value: &str) -> Result<&'static str> {
    match value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "text/html" => Ok("text/html"),
        "image/png" => Ok("image/png"),
        "image/jpeg" => Ok("image/jpeg"),
        "image/gif" => Ok("image/gif"),
        "image/webp" => Ok("image/webp"),
        "image/x-icon" => Ok("image/x-icon"),
        "image/vnd.microsoft.icon" => Ok("image/vnd.microsoft.icon"),
        _ => Err(Error::Unsupported(
            "navigation requires HTML or a supported image".into(),
        )),
    }
}

pub(crate) fn html<'a>(url: &str, kind: &str, source: &'a str) -> Result<Cow<'a, str>> {
    if content_type(kind)? == "text/html" {
        return Ok(Cow::Borrowed(source));
    }
    let address = url
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    Ok(Cow::Owned(format!(
        "<!DOCTYPE html><html><head></head><body><img src=\"{address}\"></body></html>"
    )))
}
