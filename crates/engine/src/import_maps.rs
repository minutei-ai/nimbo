use std::collections::BTreeMap;

use serde_json::{Map, Value};
use url::Url;

use crate::{Error, Result};

type Specifiers = BTreeMap<String, Option<Url>>;

/// Frozen parser-time map; dynamic registration and integrity are separate capabilities.
#[derive(Clone, Default)]
pub(crate) struct ImportMap {
    imports: Specifiers,
    scopes: BTreeMap<String, Specifiers>,
}

impl ImportMap {
    pub(crate) fn parse(source: &str, base: &Url) -> Result<Self> {
        if source.len() > 64 * 1024 {
            return Err(Error::Limit("import map bytes"));
        }
        let value: Value = serde_json::from_str(source)
            .map_err(|error| Error::JavaScript(format!("invalid import map: {error}")))?;
        let object = value
            .as_object()
            .ok_or_else(|| invalid("object required"))?;
        if object.contains_key("integrity") {
            return Err(Error::Unsupported("import map integrity".into()));
        }
        let mut entries = 0_usize;
        let imports = parse_specifiers(object.get("imports"), base, &mut entries)?;
        let mut scopes = BTreeMap::new();
        if let Some(value) = object.get("scopes") {
            let object = value
                .as_object()
                .ok_or_else(|| invalid("scopes object required"))?;
            if object.len() > 128 {
                return Err(Error::Limit("import map scopes"));
            }
            for (key, value) in object {
                let specifiers = parse_specifiers(Some(value), base, &mut entries)?;
                if let Ok(scope) = base.join(key) {
                    scopes.insert(scope.to_string(), specifiers);
                }
            }
        }
        Ok(Self { imports, scopes })
    }

    pub(crate) fn resolve(&self, name: &str, base: &Url) -> Result<Url> {
        if name.len() > 4096 {
            return Err(Error::Limit("module specifier bytes"));
        }
        let url = url_like(name, base);
        let normalized = url.as_ref().map_or(name, Url::as_str);
        for (scope, specifiers) in self.scopes.iter().rev() {
            if (scope == base.as_str()
                || (scope.ends_with('/') && base.as_str().starts_with(scope)))
                && let Some(result) = match_specifier(specifiers, normalized, url.as_ref())?
            {
                return Ok(result);
            }
        }
        if let Some(result) = match_specifier(&self.imports, normalized, url.as_ref())? {
            return Ok(result);
        }
        url.ok_or_else(|| invalid("bare module specifier requires an import map"))
    }
}

fn invalid(message: &str) -> Error {
    Error::JavaScript(message.into())
}

fn url_like(name: &str, base: &Url) -> Option<Url> {
    if name.starts_with('/') || name.starts_with("./") || name.starts_with("../") {
        base.join(name).ok()
    } else {
        Url::parse(name).ok()
    }
}

fn parse_specifiers(value: Option<&Value>, base: &Url, entries: &mut usize) -> Result<Specifiers> {
    let Some(value) = value else {
        return Ok(BTreeMap::new());
    };
    let object: &Map<String, Value> = value
        .as_object()
        .ok_or_else(|| invalid("import map specifiers object required"))?;
    *entries = entries.saturating_add(object.len());
    if *entries > 1024 {
        return Err(Error::Limit("import map entries"));
    }
    let mut result = BTreeMap::new();
    for (key, value) in object {
        if key.is_empty() {
            continue;
        }
        let normalized = url_like(key, base).map_or_else(|| key.clone(), |url| url.to_string());
        let target = value
            .as_str()
            .and_then(|name| url_like(name, base))
            .filter(|url| !key.ends_with('/') || url.as_str().ends_with('/'));
        result.insert(normalized, target);
    }
    Ok(result)
}

fn match_specifier(map: &Specifiers, name: &str, url: Option<&Url>) -> Result<Option<Url>> {
    if let Some(target) = map.get(name) {
        return target
            .clone()
            .map(Some)
            .ok_or_else(|| invalid("module specifier blocked by import map"));
    }
    for (key, target) in map.iter().rev() {
        let suffix = name.strip_prefix(key);
        let prefix = key.ends_with('/')
            && suffix.is_some()
            && url.is_none_or(|url| {
                matches!(
                    url.scheme(),
                    "http" | "https" | "file" | "ftp" | "ws" | "wss"
                )
            });
        if !prefix {
            continue;
        }
        let target = target
            .as_ref()
            .ok_or_else(|| invalid("module specifier blocked by import map"))?;
        let resolved = target
            .join(suffix.unwrap_or_default())
            .map_err(|error| invalid(&error.to_string()))?;
        if !resolved.as_str().starts_with(target.as_str()) {
            return Err(invalid(
                "module specifier backtracks above import map prefix",
            ));
        }
        return Ok(Some(resolved));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::ImportMap;
    use crate::Result;
    use url::Url;

    #[test]
    fn aliases_prefixes_scopes_and_url_normalization() -> Result<()> {
        let base = Url::parse("https://example.test/app/page")
            .map_err(|e| super::invalid(&e.to_string()))?;
        let map = ImportMap::parse(
            r#"{"imports":{"pkg":"./main.js","pkg/":"./lib/","pkg/deep/":"./deep/","./old.js":"./new.js","fallback":"./fallback.js"},"scopes":{"./scope/":{"pkg":"./scoped.js"},"./scope/deep/":{"other":"./other.js"}}}"#,
            &base,
        )?;
        for (name, expected) in [
            ("pkg", "main.js"),
            ("pkg/item.js", "lib/item.js"),
            ("pkg/deep/item.js", "deep/item.js"),
            ("./x/../old.js", "new.js"),
        ] {
            assert_eq!(
                map.resolve(name, &base)?.as_str(),
                base.join(expected)
                    .map_err(|e| super::invalid(&e.to_string()))?
                    .as_str()
            );
        }
        let scoped = base
            .join("scope/deep/module.js")
            .map_err(|e| super::invalid(&e.to_string()))?;
        assert_eq!(map.resolve("pkg", &scoped)?.path(), "/app/scoped.js");
        assert_eq!(map.resolve("fallback", &scoped)?.path(), "/app/fallback.js");
        assert!(map.resolve("unknown", &base).is_err());
        Ok(())
    }

    #[test]
    fn normalized_aliases_retain_json_declaration_order() -> Result<()> {
        let base =
            Url::parse("https://example.test/").map_err(|e| super::invalid(&e.to_string()))?;
        for (source, expected) in [
            (
                r#"{"imports":{"./z/../a.js":"./first.js","./a.js":"./second.js"}}"#,
                "/second.js",
            ),
            (
                r#"{"imports":{"./a.js":"./second.js","./z/../a.js":"./first.js"}}"#,
                "/first.js",
            ),
        ] {
            assert_eq!(
                ImportMap::parse(source, &base)?
                    .resolve("./a.js", &base)?
                    .path(),
                expected
            );
        }
        Ok(())
    }

    #[test]
    fn map_entry_and_scope_budgets_are_independent() -> Result<()> {
        let base =
            Url::parse("https://example.test/").map_err(|e| super::invalid(&e.to_string()))?;
        let imports: serde_json::Map<String, serde_json::Value> = (0..1025)
            .map(|i| (format!("module{i}"), serde_json::Value::Null))
            .collect();
        let source = serde_json::json!({"imports": imports}).to_string();
        assert!(matches!(
            ImportMap::parse(&source, &base),
            Err(crate::Error::Limit("import map entries"))
        ));
        let scopes: serde_json::Map<String, serde_json::Value> = (0..129)
            .map(|i| (format!("/scope{i}/"), serde_json::json!({})))
            .collect();
        let source = serde_json::json!({"scopes": scopes}).to_string();
        assert!(matches!(
            ImportMap::parse(&source, &base),
            Err(crate::Error::Limit("import map scopes"))
        ));
        Ok(())
    }

    #[test]
    fn blocked_entries_prevent_fallback_and_prefix_escape() -> Result<()> {
        let base =
            Url::parse("https://example.test/").map_err(|e| super::invalid(&e.to_string()))?;
        let map = ImportMap::parse(
            r#"{"imports":{"x":"/ok.js","pkg/":"/lib/","bad/":"/not-directory"},"scopes":{"/scope/":{"x":null}}}"#,
            &base,
        )?;
        assert!(
            map.resolve(
                "x",
                &base
                    .join("scope/a.js")
                    .map_err(|e| super::invalid(&e.to_string()))?
            )
            .is_err()
        );
        for name in ["pkg/../escape.js", "pkg/%2e%2e/escape.js", "bad/file.js"] {
            assert!(map.resolve(name, &base).is_err());
        }
        assert!(ImportMap::parse("[]", &base).is_err());
        assert!(ImportMap::parse(r#"{"integrity":{}}"#, &base).is_err());
        assert!(ImportMap::parse(&" ".repeat(65537), &base).is_err());
        Ok(())
    }
}
