use std::{cell::Cell, rc::Rc, sync::Arc, time::Instant};

use crate::machine::{Response, parse_url};
use reqwest::{
    Client, Url,
    header::{COOKIE, LOCATION, SET_COOKIE},
    redirect::Policy,
};

use crate::{Error, Limits, MediaEnvironment, Page, Result, cookies::Session};

/// Uma sessão HTTP com cookies próprios e uma única origem autorizada.
#[derive(Debug)]
pub struct Browser {
    client: Client,
    runtime: Arc<tokio::runtime::Runtime>,
    origin: Url,
    limits: Limits,
    media: MediaEnvironment,
    session: Session,
}

impl Browser {
    /// Cria uma sessão; a origem também limita redirects, scripts e fetch.
    ///
    /// # Errors
    /// Retorna erro para URL inválida, limites inválidos ou falha no cliente TLS.
    pub fn new(origin: &str, limits: Limits) -> Result<Self> {
        Self::with_media(origin, limits, MediaEnvironment::default())
    }

    /// Creates a browser with an explicit logical viewport and media preferences.
    ///
    /// # Errors
    /// Rejects invalid dimensions/preferences, origins, limits or TLS initialization.
    pub fn with_media(origin: &str, limits: Limits, media: MediaEnvironment) -> Result<Self> {
        Self::with_media_and_proxy(origin, limits, media, None)
    }

    /// Creates a browser whose navigation and page subrequests share an explicit proxy.
    /// HTTP proxies tunnel HTTPS with CONNECT; SOCKS5 supports local or remote DNS.
    /// Credentials in the proxy URL stay in native transport and never enter page JS.
    ///
    /// # Errors
    /// Rejects invalid proxy configuration, origins, limits, media or TLS initialization.
    pub fn with_proxy(origin: &str, limits: Limits, proxy: &str) -> Result<Self> {
        Self::with_media_and_proxy(origin, limits, MediaEnvironment::default(), Some(proxy))
    }

    /// Creates a browser with explicit media and an optional HTTP or SOCKS5 proxy.
    /// Ambient system proxy variables are ignored, including when no proxy is supplied.
    ///
    /// # Errors
    /// Rejects invalid proxy configuration, origins, limits, media or TLS initialization.
    pub fn with_media_and_proxy(
        origin: &str,
        limits: Limits,
        media: MediaEnvironment,
        proxy: Option<&str>,
    ) -> Result<Self> {
        media.validate()?;
        let origin = parse_url(origin)?;
        if limits.max_javascript_ticks == 0
            || limits.max_microtasks == 0
            || limits.max_timers == 0
            || limits.max_timer_tasks == 0
            || limits.max_expression_bytes == 0
            || limits.timeout.is_zero()
            || limits.max_response_bytes == 0
            || limits.max_stylesheet_bytes == 0
            || limits.max_requests == 0
            || limits.max_layout_nodes == 0
            || limits.max_dom_operations == 0
            || limits.max_dom_write_bytes == 0
            || limits.max_storage_bytes == 0
            || limits.javascript_memory_bytes < 1024 * 1024
        {
            return Err(Error::Limit("invalid configuration"));
        }
        let mut builder = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .user_agent("Nimbo/0.1");
        if let Some(proxy) = proxy {
            builder = builder.proxy(explicit_proxy(proxy)?);
        }
        let runtime = Arc::new(
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?,
        );
        let client = builder.build()?;
        Ok(Self {
            client,
            runtime,
            origin,
            limits,
            media,
            session: Session::default(),
        })
    }

    /// Carrega HTML e executa scripts clássicos após o parsing do documento.
    ///
    /// # Errors
    /// Propaga falhas de transporte, origem, limites, HTML ou JavaScript.
    pub fn navigate(&self, url: &str) -> Result<Page> {
        self.navigate_with_cancel(url, &crate::CancellationToken::new())
    }

    /// Loads a page with a cancellation signal that also covers later evaluation and readiness.
    ///
    /// # Errors
    /// Returns `Error::Cancelled` on cancellation, or the normal navigation failures.
    pub fn navigate_with_cancel(
        &self,
        url: &str,
        cancellation: &crate::CancellationToken,
    ) -> Result<Page> {
        cancellation.check()?;
        let deadline = Instant::now()
            .checked_add(self.limits.timeout)
            .ok_or(Error::Limit("invalid timeout"))?;
        let transport = Rc::new(Transport {
            client: self.client.clone(),
            runtime: Arc::clone(&self.runtime),
            cancellation: cancellation.clone(),
            origin: self.origin.clone(),
            deadline,
            limits: self.limits,
            requests: Cell::new(0),
            bytes: Cell::new(0),
            cookies: self.session.cookies.clone(),
        });
        let response = transport.request(&self.origin, url, "GET", "", false)?;
        if !(200..300).contains(&response.status) {
            return Err(Error::HttpStatus(response.status));
        }
        if !response.content_type.starts_with("text/html") {
            return Err(Error::Unsupported("navigation requires text/html".into()));
        }
        Page::load(
            response,
            transport,
            self.session.clone(),
            self.media.clone(),
        )
    }
}

#[derive(Debug)]
pub(crate) struct Transport {
    client: Client,
    runtime: Arc<tokio::runtime::Runtime>,
    pub cancellation: crate::CancellationToken,
    origin: Url,
    pub deadline: Instant,
    pub limits: Limits,
    requests: Cell<usize>,
    bytes: Cell<usize>,
    cookies: crate::cookies::Cookies,
}

impl Transport {
    pub(crate) fn check_deadline(&self) -> Result<()> {
        self.cancellation.check()?;
        if Instant::now() >= self.deadline {
            return Err(Error::Limit("navigation deadline"));
        }
        Ok(())
    }

    pub(crate) fn resolve(&self, base: &Url, value: &str) -> Result<Url> {
        let url = base
            .join(value)
            .map_err(|error| Error::InvalidUrl(error.to_string()))?;
        let url = parse_url(url.as_str())?;
        if url.origin() != self.origin.origin() {
            return Err(Error::Origin(url.to_string()));
        }
        Ok(url)
    }

    pub(crate) fn request(
        &self,
        base: &Url,
        value: &str,
        method: &str,
        body: &str,
        binary: bool,
    ) -> Result<Response> {
        self.run(self.request_async(base, value, method, body, binary))
    }

    fn run<T>(&self, work: impl Future<Output = Result<T>>) -> Result<T> {
        self.check_deadline()?;
        self.runtime.block_on(async {
            match futures_util::future::select(
                Box::pin(work),
                Box::pin(self.cancellation.cancelled()),
            )
            .await
            {
                futures_util::future::Either::Left((result, _cancel)) => result,
                futures_util::future::Either::Right(((), _work)) => Err(Error::Cancelled),
            }
        })
    }

    pub(crate) fn wait(&self, duration: std::time::Duration) -> Result<()> {
        self.run(async {
            tokio::time::sleep(duration).await;
            self.check_deadline()
        })
    }

    async fn request_async(
        &self,
        base: &Url,
        value: &str,
        method: &str,
        body: &str,
        binary: bool,
    ) -> Result<Response> {
        let mut url = self.resolve(base, value)?;
        let mut method = match method {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            _ => return Err(Error::Unsupported("only GET and POST".into())),
        };
        if body.len() > self.limits.max_response_bytes {
            return Err(Error::Limit("request body bytes"));
        }
        for _ in 0..=10 {
            self.check_deadline()?;
            if self.requests.get() >= self.limits.max_requests {
                return Err(Error::Limit("request count"));
            }
            self.requests.set(self.requests.get().saturating_add(1));
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .timeout(self.deadline.saturating_duration_since(Instant::now()));
            let cookies = self.cookies.header(&url, false);
            if !cookies.is_empty() {
                request = request.header(COOKIE, cookies);
            }
            if method == reqwest::Method::POST {
                request = request.body(body.to_owned());
            }
            let response = request.send().await?;
            for header in response.headers().get_all(SET_COOKIE) {
                if let Ok(value) = header.to_str() {
                    self.cookies.set(&url, value, false)?;
                }
            }
            let status = response.status();
            if matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|header| header.to_str().ok())
                    .ok_or_else(|| Error::InvalidUrl("redirect without valid Location".into()))?;
                url = self.resolve(&url, location)?;
                if status.as_u16() == 303
                    || (matches!(status.as_u16(), 301 | 302) && method == reqwest::Method::POST)
                {
                    method = reqwest::Method::GET;
                }
                continue;
            }
            return self.read_response(response, &url, binary).await;
        }
        Err(Error::Limit("redirect count"))
    }

    async fn read_response(
        &self,
        mut response: reqwest::Response,
        url: &Url,
        binary: bool,
    ) -> Result<Response> {
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|header| header.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let remaining = self
            .limits
            .max_response_bytes
            .saturating_sub(self.bytes.get());
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            self.check_deadline()?;
            if chunk.len() > remaining.saturating_sub(bytes.len()) {
                return Err(Error::Limit("total response bytes"));
            }
            bytes.extend_from_slice(&chunk);
        }
        self.check_deadline()?;
        if bytes.len() > remaining {
            return Err(Error::Limit("total response bytes"));
        }
        self.bytes.set(self.bytes.get().saturating_add(bytes.len()));
        let (body, raw_body) = if binary {
            (String::new(), Some(bytes))
        } else {
            (
                crate::response_encoding::decode(
                    &bytes,
                    &content_type,
                    self.limits.max_response_bytes,
                )?,
                None,
            )
        };
        Ok(Response {
            url: url.to_string(),
            status,
            body,
            raw_body,
            content_type,
        })
    }
}

fn explicit_proxy(value: &str) -> Result<reqwest::Proxy> {
    let invalid = || Error::Unsupported("invalid proxy configuration".into());
    if value.len() > 8192 {
        return Err(invalid());
    }
    let url = Url::parse(value).map_err(|_error| invalid())?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h")
        || url.host_str().is_none()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    reqwest::Proxy::all(url).map_err(|_error| invalid())
}
