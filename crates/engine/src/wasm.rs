use crate::{Limits, MediaEnvironment, machine::Machine};
use std::{fmt, sync::Arc};
use wasm_bindgen::prelude::*;

/// Versão do núcleo incorporado ao módulo Wasm.
#[wasm_bindgen]
#[must_use]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// Página Rust/QuickJS dentro do Wasm; o host atende HTTP e esperas do relógio.
#[wasm_bindgen]
pub struct WasmPage {
    machine: Machine,
}

impl fmt::Debug for WasmPage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("WasmPage").finish_non_exhaustive()
    }
}

#[wasm_bindgen]
impl WasmPage {
    /// Cria uma página com os limites padrão e sem acesso direto ao runtime do Worker.
    /// `execute_scripts` omitido executa scripts; false extrai somente o HTML recebido.
    /// `max_stylesheet_bytes` configura o orçamento CSS, até o teto de resposta padrão.
    /// `max_layout_nodes` configura visitas por coleta CSS/layout, de 1 até 4096.
    /// `max_dom_operations` configures shared DOM/CSS work, from 1 through 1,000,000.
    ///
    /// # Errors
    /// Retorna falha de URL, HTML, scripts, alocação ou inicialização do motor.
    #[wasm_bindgen(constructor)]
    #[expect(
        clippy::too_many_arguments,
        reason = "Preserve the positional Wasm constructor ABI when adding optional budgets"
    )]
    pub fn new(
        html: &str,
        url: &str,
        execute_scripts: Option<bool>,
        media: Option<String>,
        max_stylesheet_bytes: Option<usize>,
        max_layout_nodes: Option<usize>,
        cookies: Option<WasmCookies>,
        max_dom_operations: Option<usize>,
    ) -> Result<Self, String> {
        let media: MediaEnvironment = media
            .map_or_else(
                || Ok(MediaEnvironment::default()),
                |media| serde_json::from_str(&media),
            )
            .map_err(|error| error.to_string())?;
        media.validate().map_err(|error| error.to_string())?;
        let mut limits = Limits::default();
        if let Some(bytes) = max_stylesheet_bytes {
            if bytes == 0 || bytes > limits.max_response_bytes {
                return Err("resource limit: invalid stylesheet byte configuration".into());
            }
            limits.max_stylesheet_bytes = bytes;
        }
        if let Some(nodes) = max_layout_nodes {
            if nodes == 0 || nodes > 4096 {
                return Err("resource limit: invalid layout node configuration".into());
            }
            limits.max_layout_nodes = nodes;
        }
        if let Some(operations) = max_dom_operations {
            if operations == 0 || operations > 1_000_000 {
                return Err("resource limit: invalid DOM operation configuration".into());
            }
            limits.max_dom_operations = operations;
        }
        Machine::new(
            html,
            url,
            limits,
            Arc::new(|| false),
            execute_scripts.unwrap_or(true),
            crate::cookies::Session {
                storage: std::rc::Rc::default(),
                cookies: cookies.map_or_else(crate::cookies::Cookies::default, |jar| jar.cookies),
            },
            media,
        )
        .map(|machine| Self { machine })
        .map_err(|error| error.to_string())
    }

    /// Retorna request, wait, ready ou result em JSON. Scripts ficam no motor.
    ///
    /// # Errors
    /// Retorna falha de protocolo, JavaScript ou limite de recursos.
    pub fn step(&mut self) -> Result<String, String> {
        self.machine
            .step()
            .and_then(|action| serde_json::to_string(&action).map_err(crate::Error::from))
            .map_err(|error| error.to_string())
    }

    /// Avança o relógio monotônico da página com tempo real decorrido do host.
    ///
    /// # Errors
    /// Rejeita valores não finitos ou regressões de relógio.
    pub fn advance(&self, milliseconds: f64) -> Result<(), String> {
        self.machine
            .advance(milliseconds)
            .map_err(|error| error.to_string())
    }

    /// Entrega uma resposta HTTP serializada para a ação pendente.
    ///
    /// # Errors
    /// Retorna erro para JSON, origem, status, protocolo ou execução inválidos.
    pub fn respond(&mut self, response: &str) -> Result<(), String> {
        serde_json::from_str(response)
            .map_err(crate::Error::from)
            .and_then(|response| self.machine.respond(&response))
            .map_err(|error| error.to_string())
    }

    /// Rejeita o request pendente sem expor objetos ou bindings do Worker à página.
    ///
    /// # Errors
    /// Retorna falha para protocolo ou resolução de Promise inválidos.
    pub fn reject(&mut self, message: &str) -> Result<(), String> {
        self.machine
            .reject(message)
            .map_err(|error| error.to_string())
    }

    /// Inicia uma extração; o host continua avançando via step/respond.
    ///
    /// # Errors
    /// Retorna falha de estado, expressão, JavaScript ou limite.
    pub fn evaluate(&mut self, expression: &str) -> Result<(), String> {
        self.machine
            .evaluate(expression)
            .map_err(|error| error.to_string())
    }
}

/// Limites padrão do motor, compartilhados com a camada de transporte do Worker.
#[wasm_bindgen]
#[must_use]
pub fn engine_limits() -> String {
    let limits = Limits::default();
    serde_json::json!({ "timeoutMs": limits.timeout.as_millis(), "maxResponseBytes": limits.max_response_bytes, "maxStylesheetBytes": limits.max_stylesheet_bytes, "maxLayoutNodes": limits.max_layout_nodes, "maxRequests": limits.max_requests, "maxExpressionBytes": limits.max_expression_bytes }).to_string()
}

/// Decodes bounded HTTP text using BOM precedence and a transport charset label.
///
/// # Errors
/// Rejects encoded or decoded bodies exceeding the default response-byte budget.
#[wasm_bindgen]
pub fn decode_response(bytes: &[u8], content_type: &str) -> Result<String, String> {
    crate::response_encoding::decode(bytes, content_type, Limits::default().max_response_bytes)
        .map_err(|error| error.to_string())
}

/// Bounded session jar shared by the Rust page and the host HTTP transport.
#[wasm_bindgen]
#[derive(Debug, Default)]
pub struct WasmCookies {
    cookies: crate::cookies::Cookies,
}

#[wasm_bindgen]
impl WasmCookies {
    /// Creates an isolated cookie session.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Shares this jar without copying its cookie state.
    #[must_use]
    pub fn share(&self) -> Self {
        Self {
            cookies: self.cookies.clone(),
        }
    }

    /// HTTP Cookie header for the destination, including `HttpOnly` cookies.
    /// # Errors
    /// Rejects an invalid HTTP(S) URL.
    pub fn header(&self, url: &str) -> Result<String, String> {
        crate::machine::parse_url(url)
            .map(|url| self.cookies.header(&url, false))
            .map_err(|error| error.to_string())
    }

    /// Accepts a Set-Cookie response header using the shared cookie rules.
    /// # Errors
    /// Rejects invalid destinations and exhausted session budgets.
    pub fn set(&self, url: &str, value: &str) -> Result<(), String> {
        crate::machine::parse_url(url)
            .and_then(|url| self.cookies.set(&url, value, false))
            .map_err(|error| error.to_string())
    }
}
