use std::{
    cell::Cell,
    marker::PhantomData,
    rc::Rc,
    sync::{Arc, Mutex},
    time::Instant,
};

use crate::machine::{FetchOptions, Response, parse_url};
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
    /// Proxy installed on a shared client for the duration of this session's requests.
    proxy_url: Option<Url>,
    proxy_slot: Option<Arc<Mutex<Option<Url>>>>,
}

/// Process-wide Tokio runtime and HTTP client shared by many isolated sessions.
///
/// Each [`Browser`] opened from a host keeps its own cookies and Web Storage.
/// The host reuses the client pool and runtime, which is the expensive part of
/// `Browser::new`. One host must drive one navigation at a time: the shared
/// client reads the current session's proxy when a request starts.
#[derive(Debug)]
pub struct Host {
    runtime: Arc<tokio::runtime::Runtime>,
    client: Client,
    proxy: Arc<Mutex<Option<Url>>>,
    /// Current-thread runtime: a host stays on the thread that drives it.
    _thread: PhantomData<Cell<()>>,
}

impl Browser {
    /// Cria uma sessão. A origem limita o documento, módulos e `fetch`.
    /// Um script clássico pode carregar outro destino HTTP(S).
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
        validate_limits(&limits)?;
        let mut builder = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .user_agent(crate::USER_AGENT);
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
            proxy_url: None,
            proxy_slot: None,
        })
    }

    fn install_proxy(&self) -> Result<()> {
        let Some(slot) = &self.proxy_slot else {
            return Ok(());
        };
        let mut guard = slot
            .lock()
            .map_err(|_error| Error::Unsupported("proxy lock poisoned".into()))?;
        (*guard).clone_from(&self.proxy_url);
        drop(guard);
        Ok(())
    }
}

impl Host {
    /// Builds one runtime and one HTTP client. Ambient proxy variables are ignored.
    ///
    /// # Errors
    /// Returns an error when the runtime or TLS client cannot be created.
    pub fn new() -> Result<Self> {
        let proxy = Arc::new(Mutex::new(None));
        let slot = Arc::clone(&proxy);
        let client = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .user_agent(crate::USER_AGENT)
            .proxy(reqwest::Proxy::custom(move |_url: &Url| {
                locked_proxy(&slot)
            }))
            .build()?;
        let runtime = Arc::new(
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?,
        );
        Ok(Self {
            runtime,
            client,
            proxy,
            _thread: PhantomData,
        })
    }

    /// Opens an isolated session. `proxy` is an explicit HTTP or SOCKS URL, or direct.
    ///
    /// # Errors
    /// Rejects an invalid origin, limits or proxy configuration.
    pub fn open(&self, origin: &str, limits: Limits, proxy: Option<&str>) -> Result<Browser> {
        let media = MediaEnvironment::default();
        media.validate()?;
        let origin = parse_url(origin)?;
        validate_limits(&limits)?;
        let proxy_url = proxy.map(checked_proxy_url).transpose()?;
        Ok(Browser {
            client: self.client.clone(),
            runtime: Arc::clone(&self.runtime),
            origin,
            limits,
            media,
            session: Session::default(),
            proxy_url,
            proxy_slot: Some(Arc::clone(&self.proxy)),
        })
    }
}

impl Browser {
    /// Ends this browser's session by discarding its cookies and Web Storage.
    /// Pages already returned keep running and observe the empty session.
    pub fn clear_session(&self) {
        self.session.clear();
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
        self.navigate_with_diagnostics(url, cancellation)
            .map_err(|failure| failure.error)
    }

    /// Loads a page with structured failure stages and the original cancellation signal.
    /// This does not collect heap snapshots, log errors or alter navigation budgets.
    ///
    /// # Errors
    /// Returns the original error with its native operation and last scheduler state.
    pub fn navigate_with_diagnostics(
        &self,
        url: &str,
        cancellation: &crate::CancellationToken,
    ) -> std::result::Result<Page, crate::NavigationFailure> {
        use crate::{NavigationFailure as Failure, NavigationStage as Stage};
        cancellation
            .check()
            .map_err(|error| Failure::new(Stage::Validation, error))?;
        self.install_proxy()
            .map_err(|error| Failure::new(Stage::Validation, error))?;
        let deadline = Instant::now()
            .checked_add(self.limits.timeout)
            .ok_or_else(|| Failure::new(Stage::Validation, Error::Limit("invalid timeout")))?;
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
        let started = Instant::now();
        let response = transport
            .request(
                &self.origin,
                url,
                "GET",
                "",
                false,
                &FetchOptions::default(),
            )
            .map_err(|error| Failure::new(Stage::Request, error))?;
        if !(200..300).contains(&response.status) {
            return Err(Failure::new(
                Stage::Response,
                Error::HttpStatus(response.status),
            ));
        }
        crate::navigation_document::content_type(&response.content_type)
            .map_err(|error| Failure::new(Stage::Response, error))?;
        Page::load(
            response,
            transport,
            self.session.clone(),
            self.media.clone(),
            started.elapsed(),
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

    pub(crate) fn resolve(&self, base: &Url, value: &str, allow_cross_origin: bool) -> Result<Url> {
        let url = base
            .join(value)
            .map_err(|error| Error::InvalidUrl(error.to_string()))?;
        let url = parse_url(url.as_str())?;
        if !allow_cross_origin && url.origin() != self.origin.origin() {
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
        options: &FetchOptions,
    ) -> Result<Response> {
        self.run(self.request_async(base, value, method, body, binary, options))
    }

    pub(crate) fn run<T>(&self, work: impl Future<Output = Result<T>>) -> Result<T> {
        self.check_deadline()?;
        self.runtime.block_on(async {
            match futures_util::future::select(
                Box::pin(async {
                    tokio::time::timeout_at(tokio::time::Instant::from_std(self.deadline), work)
                        .await
                        .map_err(|_elapsed| Error::Limit("navigation deadline"))?
                }),
                Box::pin(self.cancellation.cancelled()),
            )
            .await
            {
                futures_util::future::Either::Left((result, _cancel)) => result,
                futures_util::future::Either::Right(((), _work)) => Err(Error::Cancelled),
            }
        })
    }

    pub(crate) async fn request_async(
        &self,
        base: &Url,
        value: &str,
        method: &str,
        body: &str,
        binary: bool,
        options: &FetchOptions,
    ) -> Result<Response> {
        let mut url = self.resolve(base, value, options.allow_cross_origin)?;
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
            for (name, value) in &options.headers {
                request = request.header(name.as_str(), value.as_str());
            }
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
                if options.reject_redirects {
                    return Err(Error::Unsupported("redirect rejected by fetch".into()));
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|header| header.to_str().ok())
                    .ok_or_else(|| Error::InvalidUrl("redirect without valid Location".into()))?;
                url = self.resolve(&url, location, options.allow_cross_origin)?;
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
        let headers = response
            .headers()
            .iter()
            .filter(|(name, _)| *name != SET_COOKIE)
            .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_owned())))
            .collect();
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
        let content_type = if let Some(kind) =
            crate::navigation_document::sniff_image_type(&content_type, &bytes)
        {
            kind.to_owned()
        } else {
            content_type
        };
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
            headers,
        })
    }
}

fn locked_proxy(slot: &Mutex<Option<Url>>) -> Option<Url> {
    let guard = slot
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let proxy = guard.clone();
    drop(guard);
    proxy
}

fn checked_proxy_url(value: &str) -> Result<Url> {
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
    Ok(url)
}

fn explicit_proxy(value: &str) -> Result<reqwest::Proxy> {
    reqwest::Proxy::all(checked_proxy_url(value)?)
        .map_err(|_error| Error::Unsupported("invalid proxy configuration".into()))
}

fn validate_limits(limits: &Limits) -> Result<()> {
    if limits.max_javascript_ticks == 0
        || limits.max_microtasks == 0
        || limits.max_timers == 0
        || limits.max_timer_tasks == 0
        || limits.max_expression_bytes == 0
        || limits.timeout.is_zero()
        || limits.max_response_bytes == 0
        || limits.max_initial_dom_nodes == 0
        || limits.max_dom_nodes == 0
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
    Ok(())
}
