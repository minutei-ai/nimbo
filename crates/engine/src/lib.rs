//! Primeiro núcleo de scraping do Nimbo: HTTP, DOM e JavaScript sem renderização.

mod dom;
mod network;
mod page;

use std::time::Duration;

pub use network::Browser;
pub use page::Page;

/// Orçamento de uma navegação, incluindo scripts, fetch e extração.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub timeout: Duration,
    pub max_response_bytes: usize,
    pub max_requests: usize,
    pub max_dom_operations: usize,
    pub max_dom_write_bytes: usize,
    pub javascript_memory_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(10),
            max_response_bytes: 2 * 1024 * 1024,
            max_requests: 32,
            max_dom_operations: 10_000,
            max_dom_write_bytes: 4 * 1024 * 1024,
            javascript_memory_bytes: 32 * 1024 * 1024,
        }
    }
}

/// Falhas explícitas; uma falha de navegação não vira extração vazia.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("origin policy: {0}")]
    Origin(String),
    #[error("resource limit: {0}")]
    Limit(&'static str),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("HTTP transport: {0}")]
    Http(#[from] reqwest::Error),
    #[error("HTTP status {0}")]
    HttpStatus(u16),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("JavaScript: {0}")]
    JavaScript(String),
    #[error("DOM: {0}")]
    Dom(String),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
