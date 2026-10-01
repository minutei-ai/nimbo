use std::{cell::Cell, io::Read, rc::Rc, time::Instant};

use reqwest::{Url, blocking::Client, header::LOCATION, redirect::Policy};
use serde::Serialize;

use crate::{Error, Limits, Page, Result};

/// Uma sessão HTTP com cookies próprios e uma única origem autorizada.
#[derive(Debug)]
pub struct Browser {
    client: Client,
    origin: Url,
    limits: Limits,
}

impl Browser {
    /// Cria uma sessão; a origem também limita redirects, scripts e fetch.
    ///
    /// # Errors
    /// Retorna erro para URL inválida, limites inválidos ou falha no cliente TLS.
    pub fn new(origin: &str, limits: Limits) -> Result<Self> {
        let origin = parse_url(origin)?;
        if limits.timeout.is_zero()
            || limits.max_response_bytes == 0
            || limits.max_requests == 0
            || limits.max_dom_operations == 0
            || limits.max_dom_write_bytes == 0
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
        let response = transport.request(&self.origin, url, "GET", "")?;
        if !(200..300).contains(&response.status) {
            return Err(Error::HttpStatus(response.status));
        }
        if !response.content_type.starts_with("text/html") {
            return Err(Error::Unsupported("navigation requires text/html".into()));
        }
        Page::load(response, transport)
    }
}

pub(crate) fn parse_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|error| Error::InvalidUrl(error.to_string()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::InvalidUrl(
            "only HTTP(S) without URL credentials".into(),
        ));
    }
    Ok(url)
}

#[derive(Debug, Serialize)]
pub(crate) struct Response {
    pub url: String,
    pub status: u16,
    pub body: String,
    pub content_type: String,
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
            return self.read_response(response, &url);
        }
        Err(Error::Limit("redirect count"))
    }

    fn read_response(&self, response: reqwest::blocking::Response, url: &Url) -> Result<Response> {
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
        let body = String::from_utf8(bytes)
            .map_err(|error| Error::Unsupported(format!("only UTF-8 response bodies: {error}")))?;
        Ok(Response {
            url: url.to_string(),
            status,
            body,
            content_type,
        })
    }
}
