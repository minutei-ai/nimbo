use std::{cell::RefCell, fmt, rc::Rc, sync::Arc};

use serde_json::Value;

use crate::{
    Error, MediaEnvironment, Result,
    machine::{Action, Machine, Response, parse_url},
    network::Transport,
    storage::Storage,
};

/// Documento carregado. Drop libera DOM, contexto JS e recursos da página.
pub struct Page {
    machine: RefCell<Machine>,
    transport: Rc<Transport>,
    url: String,
    epoch: std::time::Instant,
}

impl fmt::Debug for Page {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Page")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

impl Page {
    pub(crate) fn load(
        response: Response,
        transport: Rc<Transport>,
        storage: Rc<RefCell<Storage>>,
        media: MediaEnvironment,
    ) -> Result<Self> {
        transport.check_deadline()?;
        let deadline = transport.deadline;
        let machine = Machine::new(
            &response.body,
            &response.url,
            transport.limits,
            Arc::new(move || std::time::Instant::now() >= deadline),
            true,
            storage,
            media,
        )?;
        let page = Self {
            machine: RefCell::new(machine),
            transport,
            url: response.url,
            epoch: std::time::Instant::now(),
        };
        if page.drive()?.is_some() {
            return Err(Error::Unsupported("unexpected load result".into()));
        }
        Ok(page)
    }

    /// URL final após redirects autorizados.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    fn drive(&self) -> Result<Option<String>> {
        let base = parse_url(&self.url)?;
        loop {
            self.transport.check_deadline()?;
            self.machine
                .borrow()
                .advance(self.epoch.elapsed().as_secs_f64() * 1000.0)?;
            let action = self.machine.borrow_mut().step()?;
            match action {
                Action::Ready => return Ok(None),
                Action::Result { json } => return Ok(Some(json)),
                Action::Wait { milliseconds } => {
                    let remaining = self
                        .transport
                        .deadline
                        .saturating_duration_since(std::time::Instant::now());
                    std::thread::sleep(
                        std::time::Duration::from_secs_f64(milliseconds / 1000.0).min(remaining),
                    );
                }
                Action::Request { url, method, body } => {
                    match self.transport.request(&base, &url, &method, &body) {
                        Ok(response) => self.machine.borrow_mut().respond(&response)?,
                        Err(Error::Limit(limit)) => return Err(Error::Limit(limit)),
                        Err(error) => self.machine.borrow_mut().reject(&error.to_string())?,
                    }
                }
            }
        }
    }

    /// Avalia uma expressão e retorna JSON; aceita resultado Promise.
    /// O deadline original também cobre esta extração.
    ///
    /// # Errors
    /// Retorna erro para JS inválido, Promise rejeitada/pendente, limites ou JSON inválido.
    pub fn evaluate(&self, expression: &str) -> Result<Value> {
        self.transport.check_deadline()?;
        self.machine.borrow_mut().evaluate(expression)?;
        let json = self
            .drive()?
            .ok_or_else(|| Error::JavaScript("missing extraction result".into()))?;
        Ok(serde_json::from_str(&json)?)
    }
}
