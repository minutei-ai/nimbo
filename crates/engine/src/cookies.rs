//! Session cookies shared by guest JavaScript and both HTTP transports.
use std::{cell::RefCell, cmp::Reverse, fmt, rc::Rc};

use cookie_store::{Cookie, CookieDomain};
use rquickjs::{Ctx, Exception, Function};
use url::Url;

use crate::{Error, Result, storage::Storage};

#[derive(Clone, Debug, Default)]
pub(crate) struct Session {
    pub storage: Rc<RefCell<Storage>>,
    pub cookies: Cookies,
}

impl Session {
    /// Empties cookies and Web Storage in place, so live pages observe the reset.
    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) fn clear(&self) {
        self.cookies.0.borrow_mut().clear();
        *self.storage.borrow_mut() = Storage::default();
    }
}

#[derive(Clone, Default)]
pub(crate) struct Cookies(Rc<RefCell<Vec<Cookie<'static>>>>);

impl fmt::Debug for Cookies {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Cookies")
            .field("count", &self.0.borrow().len())
            .finish_non_exhaustive()
    }
}

fn secure_context(url: &Url) -> bool {
    url.scheme() == "https"
        || url.host_str().is_some_and(|host| {
            host == "localhost"
                || host.ends_with(".localhost")
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        })
}

fn same_key(left: &Cookie<'_>, right: &Cookie<'_>) -> bool {
    left.name() == right.name()
        && left.domain.as_cow() == right.domain.as_cow()
        && left.path.as_ref() == right.path.as_ref()
}

#[cfg(any(target_arch = "wasm32", test))]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u8,
    origin: String,
    cookies: Vec<Cookie<'static>>,
}

fn check_budget(cookies: &[Cookie<'_>]) -> Result<()> {
    let bytes: usize = cookies
        .iter()
        .map(|cookie| {
            cookie
                .to_string()
                .len()
                .saturating_add(cookie.path.len())
                .saturating_add(cookie.domain.as_cow().map_or(0, |domain| domain.len()))
        })
        .sum();
    if cookies.len() > 128 || bytes > 65_536 {
        return Err(Error::Limit("cookie budget"));
    }
    Ok(())
}

impl Cookies {
    pub(crate) fn header(&self, url: &Url, document: bool) -> String {
        let mut url = url.clone();
        if secure_context(&url) {
            // Browsers treat loopback HTTP as trustworthy for Secure cookies.
            let _scheme = url.set_scheme("https");
        }
        let mut store = self.0.borrow_mut();
        store.retain(|cookie| !cookie.is_expired());
        let mut selected: Vec<_> = store
            .iter()
            .filter(|cookie| {
                cookie.matches(&url) && !(document && cookie.http_only() == Some(true))
            })
            .collect();
        // Stable sorting retains creation order, including replacement cookies.
        selected.sort_by_key(|cookie| Reverse(cookie.path.len()));
        selected
            .into_iter()
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; ")
    }

    pub(crate) fn set(&self, url: &Url, value: &str, document: bool) -> Result<()> {
        if value.len() > 4096 || value.bytes().any(|byte| byte < 32 || byte == 127) {
            return Ok(());
        }
        let Ok(mut cookie) = Cookie::parse(value, url).map(Cookie::into_owned) else {
            return Ok(());
        };
        if document && cookie.http_only() == Some(true) {
            return Ok(());
        }
        if cookie.secure() == Some(true) && !secure_context(url) {
            return Ok(());
        }
        if matches!(cookie.domain, CookieDomain::Suffix(_)) {
            let domain = cookie
                .domain
                .as_cow()
                .ok_or_else(|| Error::Unsupported("missing cookie domain".into()))?;
            if psl::suffix_str(&domain).is_some_and(|suffix| suffix == domain.as_ref()) {
                if url.host_str() != Some(domain.as_ref()) {
                    return Ok(());
                }
                cookie.domain = CookieDomain::host_only(url)
                    .map_err(|error| Error::Unsupported(error.to_string()))?;
            }
        }
        let secure_prefix = cookie.name().starts_with("__Secure-")
            || cookie.name().starts_with("__Host-")
            || cookie.name().starts_with("__Http-");
        if secure_prefix && (cookie.secure() != Some(true) || !secure_context(url)) {
            return Ok(());
        }
        if cookie.name().starts_with("__Host-")
            && (cookie.domain().is_some() || cookie.path() != Some("/"))
        {
            return Ok(());
        }
        if (cookie.name().starts_with("__Http-") || cookie.name().starts_with("__Host-Http-"))
            && cookie.http_only() != Some(true)
        {
            return Ok(());
        }
        if (cookie.same_site().is_some_and(|site| site.is_none())
            || cookie.partitioned() == Some(true))
            && cookie.secure() != Some(true)
        {
            return Ok(());
        }
        let mut store = self.0.borrow_mut();
        store.retain(|cookie| !cookie.is_expired());
        let index = store.iter().position(|old| same_key(old, &cookie));
        if index.is_some_and(|index| {
            store
                .get(index)
                .is_some_and(|old| document && old.http_only() == Some(true))
        }) {
            return Ok(());
        }
        let mut cookie_scope = url.clone();
        cookie_scope.set_path(&cookie.path);
        if !secure_context(url)
            && store.iter().any(|old| {
                old.secure() == Some(true)
                    && old.name() == cookie.name()
                    && old.domain.matches(url)
                    && old.path.matches(&cookie_scope)
            })
        {
            return Ok(());
        }
        if cookie.is_expired() {
            if let Some(index) = index {
                store.remove(index);
            }
            return Ok(());
        }
        let mut updated = store.clone();
        if let Some(index) = index {
            if let Some(old) = updated.get_mut(index) {
                *old = cookie;
            }
        } else {
            updated.push(cookie);
        }
        check_budget(&updated)?;
        *store = updated;
        Ok(())
    }

    #[cfg(any(target_arch = "wasm32", test))]
    pub(crate) fn snapshot(&self, url: &Url) -> Result<String> {
        let mut cookies = self.0.borrow_mut();
        cookies.retain(|cookie| !cookie.is_expired());
        let encoded = serde_json::to_string(&Snapshot {
            version: 1,
            origin: url.origin().ascii_serialization(),
            cookies: cookies.clone(),
        })?;
        if encoded.len() > 256 * 1024 {
            return Err(Error::Limit("cookie state bytes"));
        }
        Ok(encoded)
    }

    #[cfg(any(target_arch = "wasm32", test))]
    pub(crate) fn restore(&self, url: &Url, encoded: &str) -> Result<()> {
        if encoded.len() > 256 * 1024 {
            return Err(Error::Limit("cookie state bytes"));
        }
        let snapshot: Snapshot = serde_json::from_str(encoded)?;
        if snapshot.version != 1 {
            return Err(Error::Unsupported("cookie state version".into()));
        }
        if snapshot.origin != url.origin().ascii_serialization() {
            return Err(Error::Origin("cookie state origin mismatch".into()));
        }
        check_budget(&snapshot.cookies)?;
        let restored = Self::default();
        for cookie in snapshot.cookies {
            if cookie.is_expired() {
                continue;
            }
            if !cookie.domain.matches(url) {
                return Err(Error::Origin("cookie state domain mismatch".into()));
            }
            let mut issuing_url = url.clone();
            issuing_url.set_path(&format!("{}/_", cookie.path.as_ref()));
            restored.set(&issuing_url, &cookie.to_string(), false)?;
            let mut accepted = restored.0.borrow_mut();
            let validated = accepted
                .iter_mut()
                .find(|candidate| {
                    same_key(candidate, &cookie) && candidate.value() == cookie.value()
                })
                .ok_or_else(|| Error::Unsupported("invalid cookie state entry".into()))?;
            validated.expires = cookie.expires;
        }
        let cookies = std::mem::take(&mut *restored.0.borrow_mut());
        check_budget(&cookies)?;
        *self.0.borrow_mut() = cookies;
        Ok(())
    }

    pub(crate) fn install(&self, ctx: &Ctx<'_>, url: Url) -> rquickjs::Result<()> {
        let cookies = self.clone();
        ctx.globals().set(
            "nimboCookie",
            Function::new(
                ctx.clone(),
                move |ctx: Ctx<'_>, write: bool, value: String| {
                    if write {
                        cookies
                            .set(&url, &value, true)
                            .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?;
                    }
                    Ok::<_, rquickjs::Error>(cookies.header(&url, true))
                },
            )?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::Cookies;
    use url::Url;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn default_and_explicit_cookie_paths_have_the_same_identity() -> TestResult {
        let url = Url::parse("https://example.test/scope/start")?;
        let jar = Cookies::default();
        jar.set(&url, "token=one", false)?;
        jar.set(&url, "token=two; Path=/scope", false)?;
        assert_eq!(jar.header(&url, false), "token=two");
        Ok(())
    }

    #[test]
    fn snapshots_preserve_scoped_http_only_cookies_and_reject_cross_origin_restore() -> TestResult {
        let issued_at = Url::parse("https://example.test/scoped/issue")?;
        let home = Url::parse("https://example.test/other/home")?;
        let jar = Cookies::default();
        jar.set(
            &issued_at,
            "captcha=issued; Secure; HttpOnly; SameSite=Strict; Max-Age=3600",
            false,
        )?;
        let encoded = jar.snapshot(&issued_at)?;
        let resumed = Cookies::default();
        resumed.restore(&home, &encoded)?;
        assert_eq!(resumed.header(&issued_at, false), "captcha=issued");
        assert_eq!(resumed.header(&issued_at, true), "");
        assert_eq!(resumed.header(&home, false), "");
        assert_eq!(
            jar.0.borrow().first().map(|cookie| &cookie.expires),
            resumed.0.borrow().first().map(|cookie| &cookie.expires)
        );
        assert!(
            resumed
                .restore(&Url::parse("https://other.test/")?, &encoded)
                .is_err()
        );
        assert_eq!(resumed.header(&issued_at, false), "captcha=issued");
        assert!(resumed.restore(&home, "invalid").is_err());
        assert_eq!(resumed.header(&issued_at, false), "captcha=issued");
        Ok(())
    }

    #[test]
    fn canonical_domains_reject_public_suffixes() -> TestResult {
        for (host, suffix, parent) in [
            ("www.example.com", "COM", "EXAMPLE.COM"),
            ("www.example.test", "TEST", "EXAMPLE.TEST"),
        ] {
            let url = Url::parse(&format!("https://{host}/"))?;
            let jar = Cookies::default();
            jar.set(&url, &format!("rejected=no; Domain={suffix}"), false)?;
            assert_eq!(jar.header(&url, false), "");
            jar.set(&url, &format!("accepted=yes; Domain={parent}"), false)?;
            assert_eq!(jar.header(&url, false), "accepted=yes");
        }
        Ok(())
    }

    #[test]
    fn insecure_origins_cannot_set_secure_cookies_or_prefixes() -> TestResult {
        let url = Url::parse("http://example.test/")?;
        let jar = Cookies::default();
        for value in [
            "secure=no; Secure",
            "__Secure-rejected=no",
            "__Host-rejected=no; Secure; Path=/",
        ] {
            jar.set(&url, value, false)?;
        }
        assert_eq!(jar.header(&url, false), "");
        Ok(())
    }

    #[test]
    fn replacements_preserve_creation_order_and_host_only_identity() -> TestResult {
        let url = Url::parse("https://example.test/")?;
        let jar = Cookies::default();
        for value in ["a=one", "b=two", "a=three; Domain=example.test"] {
            jar.set(&url, value, false)?;
        }
        assert_eq!(jar.header(&url, true), "a=three; b=two");
        Ok(())
    }
    #[test]
    fn insecure_writes_cannot_overlay_secure_cookie_paths() -> TestResult {
        let secure = Url::parse("https://example.test/secret/page")?;
        let insecure = Url::parse("http://example.test/elsewhere")?;
        let jar = Cookies::default();
        jar.set(&secure, "sid=protected; Secure; Path=/secret", false)?;
        jar.set(&insecure, "sid=stolen; Path=/secret/child", true)?;
        assert_eq!(
            jar.header(&Url::parse("https://example.test/secret/child")?, false),
            "sid=protected"
        );
        jar.set(&insecure, "sid=stolen; Path=/secret", true)?;
        assert_eq!(jar.header(&secure, false), "sid=protected");
        Ok(())
    }
    #[test]
    fn guest_cookie_scope_retains_document_creation_url() -> TestResult {
        use rquickjs::{Context, Runtime};
        use std::{cell::RefCell, rc::Rc};
        let original = Url::parse("https://example.test/original/page")?;
        let document = Rc::new(RefCell::new(crate::dom::Dom::new(
            "<body>",
            crate::Limits::default(),
            crate::MediaEnvironment::default(),
            original,
            std::sync::Arc::new(|| Ok(())),
        )?));
        let jar = Cookies::default();
        jar.set(
            &Url::parse("https://example.test/next/page")?,
            "scoped=visible; Path=/next",
            false,
        )?;
        let runtime = Runtime::new()?;
        let context = Context::full(&runtime)?;
        context.with(|ctx| -> TestResult {
            jar.install(&ctx, Url::parse("https://example.test/original/page")?)?;
            assert_eq!(ctx.eval::<String, _>("nimboCookie(false,'')")?, "");
            document
                .borrow_mut()
                .call("history", 0, "push", r#"["state","/next/page"]"#)?;
            assert_eq!(ctx.eval::<String, _>("nimboCookie(false,'')")?, "");
            ctx.eval::<String, _>("nimboCookie(true,'default=scoped')")?;
            document
                .borrow_mut()
                .call("history", 0, "push", r#"["state","/elsewhere/page"]"#)?;
            assert_eq!(
                ctx.eval::<String, _>("nimboCookie(false,'')")?,
                "default=scoped"
            );
            assert_eq!(
                jar.header(&Url::parse("https://example.test/next/child")?, false),
                "scoped=visible"
            );
            Ok(())
        })
    }
}
