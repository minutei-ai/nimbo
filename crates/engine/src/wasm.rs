use crate::{Limits, machine::Machine};
use std::{fmt, sync::Arc};
use wasm_bindgen::prelude::*;

/// Versão do núcleo incorporado ao módulo Wasm.
#[wasm_bindgen]
#[must_use]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// Página Rust/QuickJS executada dentro do Wasm; o host atende somente ações HTTP.
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
    ///
    /// # Errors
    /// Retorna falha de URL, HTML, scripts, alocação ou inicialização do motor.
    #[wasm_bindgen(constructor)]
    pub fn new(html: &str, url: &str) -> Result<Self, String> {
        Machine::new(html, url, Limits::default(), Arc::new(|| false))
            .map(|machine| Self { machine })
            .map_err(|error| error.to_string())
    }

    /// Retorna uma ação JSON: request, ready ou result. O host não executa scripts de páginas.
    ///
    /// # Errors
    /// Retorna falha de protocolo, JavaScript ou limite de recursos.
    pub fn step(&mut self) -> Result<String, String> {
        self.machine
            .step()
            .and_then(|action| serde_json::to_string(&action).map_err(crate::Error::from))
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
    serde_json::json!({ "timeoutMs": limits.timeout.as_millis(), "maxResponseBytes": limits.max_response_bytes, "maxRequests": limits.max_requests, "maxExpressionBytes": limits.max_expression_bytes }).to_string()
}
