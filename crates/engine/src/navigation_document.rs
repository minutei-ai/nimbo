use std::borrow::Cow;

use crate::{Error, Result};

pub(crate) fn sniff_image_type(value: &str, bytes: &[u8]) -> Option<&'static str> {
    if !matches!(
        value
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "" | "unknown/unknown" | "application/unknown" | "*/*"
    ) {
        return None;
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
        Some("image/webp")
    } else if bytes.starts_with(b"\0\0\x01\0") {
        Some("image/x-icon")
    } else {
        None
    }
}

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

#[cfg(test)]
mod tests {
    use super::sniff_image_type;

    #[test]
    fn unknown_mime_uses_supported_image_signatures() {
        for (bytes, expected) in [
            (b"\x89PNG\r\n\x1a\n".as_slice(), "image/png"),
            (b"\xff\xd8\xff".as_slice(), "image/jpeg"),
            (b"GIF87a".as_slice(), "image/gif"),
            (b"GIF89a".as_slice(), "image/gif"),
            (b"RIFF\0\0\0\0WEBP".as_slice(), "image/webp"),
            (b"\0\0\x01\0".as_slice(), "image/x-icon"),
        ] {
            for supplied in ["", "unknown/unknown", "application/unknown", "*/*"] {
                assert_eq!(sniff_image_type(supplied, bytes), Some(expected));
            }
        }
    }

    #[test]
    fn declared_types_and_incomplete_signatures_remain_unchanged() {
        for supplied in [
            "text/html",
            "text/plain",
            "application/pdf",
            "application/octet-stream",
            "image/png",
        ] {
            assert_eq!(sniff_image_type(supplied, b"\xff\xd8\xff"), None);
        }
        for bytes in [
            b"".as_slice(),
            b"\xff\xd8".as_slice(),
            b"\x89PNG".as_slice(),
            b"RIFF\0\0\0\0WAVE".as_slice(),
            b"<svg/>".as_slice(),
        ] {
            assert_eq!(sniff_image_type("", bytes), None);
        }
    }
}
