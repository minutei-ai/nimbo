use std::{
    cell::{Cell, RefCell},
    io::Read,
    rc::Rc,
    time::Instant,
};

use crate::machine::{Response, parse_url};
use reqwest::{Url, blocking::Client, header::LOCATION, redirect::Policy};

use crate::{Error, Limits, MediaEnvironment, Page, Result, storage::Storage};

/// Uma sessão HTTP com cookies próprios e uma única origem autorizada.
#[derive(Debug)]
pub struct Browser {
    client: Client,
    origin: Url,
    limits: Limits,
    media: MediaEnvironment,
    storage: Rc<RefCell<Storage>>,
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
        let client = Client::builder()
            .cookie_store(true)
            .redirect(Policy::none())
            .no_proxy()
            .user_agent("Nimbo/0.1")
            .build()?;
        Ok(Self {
            client,
            origin,
            limits,
            media,
            storage: Rc::default(),
        })
    }

    /// Carrega HTML e executa scripts clássicos após o parsing do documento.
    ///
    /// # Errors
    /// Propaga falhas de transporte, origem, limites, HTML ou JavaScript.
    pub fn navigate(&self, url: &str) -> Result<Page> {
        let deadline = Instant::now()
            .checked_add(self.limits.timeout)
            .ok_or(Error::Limit("invalid timeout"))?;
        let transport = Rc::new(Transport {
            client: self.client.clone(),
            origin: self.origin.clone(),
            deadline,
            limits: self.limits,
            requests: Cell::new(0),
            bytes: Cell::new(0),
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
            Rc::clone(&self.storage),
            self.media.clone(),
        )
    }
}

#[derive(Debug)]
pub(crate) struct Transport {
    client: Client,
    origin: Url,
    pub deadline: Instant,
    pub limits: Limits,
    requests: Cell<usize>,
    bytes: Cell<usize>,
}

impl Transport {
    pub(crate) fn check_deadline(&self) -> Result<()> {
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
            if method == reqwest::Method::POST {
                request = request.body(body.to_owned());
            }
            let response = request.send()?;
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
            return self.read_response(response, &url, binary);
        }
        Err(Error::Limit("redirect count"))
    }

    fn read_response(
        &self,
        response: reqwest::blocking::Response,
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
        response
            .take(
                u64::try_from(remaining)
                    .unwrap_or(u64::MAX)
                    .saturating_add(1),
            )
            .read_to_end(&mut bytes)?;
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
