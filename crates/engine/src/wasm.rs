use crate::{Limits, MediaEnvironment, machine::Machine};
use std::{fmt, sync::Arc};
use wasm_bindgen::prelude::*;

/// Incremental native HTML construction, disposed by the host on cancellation or failure.
#[wasm_bindgen]
pub struct WasmPageLoader {
    state: Option<LoadingPage>,
}

struct LoadingPage {
    parser: crate::html_parse::DocumentParser,
    bytes: usize,
    url: url::Url,
    limits: Limits,
    execute_scripts: bool,
    session: crate::cookies::Session,
    media: MediaEnvironment,
}

impl fmt::Debug for WasmPageLoader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WasmPageLoader")
            .finish_non_exhaustive()
    }
}

#[wasm_bindgen]
impl WasmPageLoader {
    /// Starts the native parser with the same optional settings as `WasmPage`.
    /// No scripts run until `finish` transfers the parsed document into its machine.
    ///
    /// # Errors
    /// Returns invalid URL, media or resource settings.
    #[wasm_bindgen(constructor)]
    #[expect(
        clippy::too_many_arguments,
        reason = "Match the existing optional Wasm page settings"
    )]
    pub fn new(
        url: &str,
        execute_scripts: Option<bool>,
        media: Option<String>,
        max_stylesheet_bytes: Option<usize>,
        max_layout_nodes: Option<usize>,
        cookies: Option<WasmCookies>,
        max_dom_operations: Option<usize>,
        max_initial_dom_nodes: Option<usize>,
        max_dom_nodes: Option<usize>,
        max_response_bytes: Option<usize>,
    ) -> Result<Self, String> {
        let media: MediaEnvironment = media
            .map_or_else(
                || Ok(MediaEnvironment::default()),
                |media| serde_json::from_str(&media),
            )
            .map_err(|error| error.to_string())?;
        media.validate().map_err(|error| error.to_string())?;
        let mut limits = Limits::default();
        if let Some(bytes) = max_response_bytes {
            if bytes == 0 || bytes > MAX_RESPONSE_BYTES {
                return Err("resource limit: invalid response byte configuration".into());
            }
            limits.max_response_bytes = bytes;
            // Fetch bodies and their JavaScript copies must fit in the heap.
            limits.javascript_memory_bytes =
                limits.javascript_memory_bytes.max(bytes.saturating_mul(12));
        }
        if let Some(nodes) = max_dom_nodes {
            if nodes == 0 || nodes > limits.max_dom_nodes {
                return Err("resource limit: invalid DOM node configuration".into());
            }
            limits.max_dom_nodes = nodes;
        }
        if let Some(nodes) = max_initial_dom_nodes {
            if nodes == 0 || nodes > limits.max_initial_dom_nodes {
                return Err("resource limit: invalid initial DOM node configuration".into());
            }
            limits.max_initial_dom_nodes = nodes;
        }
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
        let url = crate::machine::parse_url(url).map_err(|error| error.to_string())?;
        Ok(Self {
            state: Some(LoadingPage {
                parser: crate::html_parse::DocumentParser::new(
                    limits.max_initial_dom_nodes.min(limits.max_dom_nodes),
                ),
                bytes: 0,
                url,
                limits,
                execute_scripts: execute_scripts.unwrap_or(true),
                session: crate::cookies::Session {
                    storage: std::rc::Rc::default(),
                    cookies: cookies
                        .map_or_else(crate::cookies::Cookies::default, |jar| jar.cookies),
                },
                media,
            }),
        })
    }

    /// Feeds at most 8 KiB of UTF-8 bytes, retaining decoder state across calls.
    /// Returns true when deep native ancestry requests a host yield before more input.
    ///
    /// # Errors
    /// Returns closed-loader, byte-budget or initial-node-budget failures.
    /// A failure releases the partial document and permanently closes the loader.
    pub fn feed(&mut self, bytes: &[u8]) -> Result<bool, String> {
        let state = self.state.as_mut().ok_or("document loader is closed")?;
        state.bytes = state.bytes.saturating_add(bytes.len());
        let result = if bytes.len() > 8192 || state.bytes > state.limits.max_response_bytes {
            Err("resource limit: HTML bytes".into())
        } else {
            state
                .parser
                .process(bytes)
                .map(|()| state.parser.needs_yield())
                .map_err(|error| error.to_string())
        };
        if result.is_err() {
            self.state = None;
        }
        result
    }

    /// Finishes tree construction and transfers its owned arena into a page.
    /// The loader can be freed after this call; the page owns the document.
    ///
    /// # Errors
    /// Returns closed-loader, parser, script initialization or resource failures.
    pub fn finish(&mut self) -> Result<WasmPage, String> {
        let state = self.state.take().ok_or("document loader is closed")?;
        let parsed = state.parser.finish().map_err(|error| error.to_string())?;
        let check: crate::BudgetCheck = Arc::new(|| Ok(()));
        let dom = crate::dom::Dom::from_document(
            parsed,
            state.limits,
            state.media.clone(),
            state.url.clone(),
            Arc::clone(&check),
        );
        Machine::from_dom(
            dom,
            state.url.as_str(),
            state.limits,
            check,
            state.execute_scripts,
            state.session,
            state.media,
        )
        .map(|machine| WasmPage { machine })
        .map_err(|error| error.to_string())
    }
}

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
    /// `max_initial_dom_nodes` can lower the initial parser's 65,536-node budget.
    /// `max_dom_nodes` can lower the page arena's cumulative 65,536-node budget.
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
        max_initial_dom_nodes: Option<usize>,
        max_dom_nodes: Option<usize>,
    ) -> Result<Self, String> {
        if html.len() > Limits::default().max_response_bytes {
            return Err("resource limit: HTML bytes".into());
        }
        let mut loader = WasmPageLoader::new(
            url,
            execute_scripts,
            media,
            max_stylesheet_bytes,
            max_layout_nodes,
            cookies,
            max_dom_operations,
            max_initial_dom_nodes,
            max_dom_nodes,
            None,
        )?;
        for bytes in html.as_bytes().chunks(8192) {
            loader.feed(bytes)?;
        }
        loader.finish()
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

    /// Serializes an explicit snapshot of page resource counters and `QuickJS` heap accounting.
    ///
    /// # Errors
    /// Returns a failure if the snapshot cannot be serialized.
    pub fn diagnostics(&self) -> Result<String, String> {
        serde_json::to_string(&self.machine.diagnostics()).map_err(|error| error.to_string())
    }

    /// Reads the last scheduler state without running JavaScript or collecting heap statistics.
    #[must_use]
    pub fn execution_phase(&self) -> String {
        self.machine.execution_phase().as_str().into()
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
            .and_then(|response| self.machine.respond(response))
            .map_err(|error| error.to_string())
    }

    /// Delivers binary fetch bytes directly, without a JSON array or a second Rust buffer.
    /// Metadata uses the ordinary response fields with an empty body and no raw body.
    ///
    /// # Errors
    /// Rejects invalid metadata, origin, protocol state or response budgets.
    pub fn respond_binary(&mut self, metadata: &str, bytes: Vec<u8>) -> Result<(), String> {
        let mut response: crate::machine::Response =
            serde_json::from_str(metadata).map_err(|error| error.to_string())?;
        if !response.body.is_empty() || response.raw_body.is_some() {
            return Err("binary response metadata must not contain a body".into());
        }
        response.raw_body = Some(bytes);
        self.machine
            .respond(response)
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

    /// Start a bounded readiness wait from serialized `Readiness` options.
    ///
    /// # Errors
    /// Returns invalid configuration, JavaScript, state or budget errors.
    pub fn wait_for(&mut self, readiness: &str) -> Result<(), String> {
        serde_json::from_str(readiness)
            .map_err(crate::Error::from)
            .and_then(|options| self.machine.wait_for(&options))
            .map_err(|error| error.to_string())
    }
}

/// Largest per-page response budget a host may request.
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

/// Limites padrão do motor, compartilhados com a camada de transporte do Worker.
#[wasm_bindgen]
#[must_use]
pub fn engine_limits() -> String {
    let limits = Limits::default();
    serde_json::json!({ "timeoutMs": limits.timeout.as_millis(), "maxResponseBytes": limits.max_response_bytes, "maxStylesheetBytes": limits.max_stylesheet_bytes, "maxLayoutNodes": limits.max_layout_nodes, "maxRequests": limits.max_requests, "maxExpressionBytes": limits.max_expression_bytes, "page": limits }).to_string()
}

/// Decodes bounded HTTP text using BOM precedence and a transport charset label.
///
/// # Errors
/// Rejects bodies above the largest page budget; hosts bound reads per page.
#[wasm_bindgen]
pub fn decode_response(bytes: &[u8], content_type: &str) -> Result<String, String> {
    crate::response_encoding::decode(bytes, content_type, MAX_RESPONSE_BYTES)
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
