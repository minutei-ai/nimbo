//! Primeiro núcleo de scraping do Nimbo: HTTP, DOM e JavaScript sem renderização.

mod animations;
mod cascade;
mod containers;
mod dom;
mod encoding;
mod font_data;
mod font_faces;
mod fonts;
mod layers;
mod layout;
mod links;
mod machine;
mod media;
mod modules;
#[cfg(not(target_arch = "wasm32"))]
mod network;
#[cfg(not(target_arch = "wasm32"))]
mod page;
mod registrations;
mod selectors;
mod storage;
mod styles;
mod stylesheets;
mod supports;
#[cfg(target_arch = "wasm32")]
mod wasm;

use std::time::Duration;

#[cfg(not(target_arch = "wasm32"))]
pub use network::Browser;
#[cfg(not(target_arch = "wasm32"))]
pub use page::Page;

/// Orçamento de uma navegação, incluindo scripts, fetch e extração.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// Chamadas máximas ao watchdog de bytecode do `QuickJS` (independente do relógio).
    pub max_javascript_ticks: usize,
    /// Microtasks máximas por página, cobrindo também cadeias de Promises.
    pub max_microtasks: usize,
    /// Timers simultâneos máximos por página.
    pub max_timers: usize,
    /// Callbacks de timers máximos por página.
    pub max_timer_tasks: usize,
    /// Bytes máximos da expressão de extração.
    pub max_expression_bytes: usize,
    /// Deadline total, compartilhado por transporte, scripts e extração.
    pub timeout: Duration,
    /// Soma máxima dos bytes de resposta recebidos durante uma navegação.
    pub max_response_bytes: usize,
    /// Requests físicos máximos, contando redirects e subrequests.
    pub max_requests: usize,
    /// Chamadas máximas da ponte DOM, incluindo leituras.
    pub max_dom_operations: usize,
    /// Bytes máximos acumulados em mutações de DOM.
    pub max_dom_write_bytes: usize,
    /// Bytes UTF-16 máximos por área de Web Storage (chaves e valores).
    pub max_storage_bytes: usize,
    /// Limite de heap do `QuickJS`; não representa memória total do processo.
    pub javascript_memory_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_javascript_ticks: 512,
            max_microtasks: 10_000,
            max_timers: 1024,
            max_timer_tasks: 10_000,
            max_expression_bytes: 64 * 1024,
            timeout: Duration::from_secs(10),
            max_response_bytes: 2 * 1024 * 1024,
            max_requests: 32,
            max_dom_operations: 10_000,
            max_dom_write_bytes: 4 * 1024 * 1024,
            max_storage_bytes: 64 * 1024,
            javascript_memory_bytes: 32 * 1024 * 1024,
        }
    }
}

/// Falhas explícitas; uma falha de navegação não vira extração vazia.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// URL malformada, esquema não permitido ou credenciais na URL.
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    /// Destino fora da origem autorizada da sessão.
    #[error("origin policy: {0}")]
    Origin(String),
    /// Orçamento excedido ou configuração de limites inválida.
    #[error("resource limit: {0}")]
    Limit(&'static str),
    /// Operação fora da superfície implementada pelo MVP.
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[cfg(not(target_arch = "wasm32"))]
    /// Falha no cliente HTTP/TLS.
    #[error("HTTP transport: {0}")]
    Http(#[from] reqwest::Error),
    /// Status de navegação ou script fora da faixa de sucesso.
    #[error("HTTP status {0}")]
    HttpStatus(u16),
    /// Falha de leitura ou escrita de bytes.
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    /// Exceção, rejeição, falha de job ou inicialização do runtime.
    #[error("JavaScript: {0}")]
    JavaScript(String),
    /// Seletor, handle ou mutação DOM inválidos.
    #[error("DOM: {0}")]
    Dom(String),
    /// Exceção DOM definida pelo contrato de uma operação de árvore.
    #[error("{name}: {message}")]
    DomException {
        /// Nome padronizado da exceção DOM.
        name: &'static str,
        /// Motivo da falha de validação, antes de qualquer mutação.
        message: &'static str,
    },
    /// Resposta da ponte ou resultado de extração inválido como JSON.
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub use media::MediaEnvironment;

/// Resultado das operações do motor.
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(target_arch = "wasm32")]
pub use wasm::{WasmPage, engine_limits, engine_version};
