use std::{cell::RefCell, fmt, rc::Rc, sync::Arc};

use serde_json::Value;

use crate::{
    Error, MediaEnvironment, Result,
    machine::{Action, Machine, Response, parse_url},
    network::Transport,
};

/// Documento carregado. Drop libera DOM, contexto JS e recursos da página.
pub struct Page {
    machine: RefCell<Machine>,
    transport: Rc<Transport>,
    url: String,
    epoch: std::time::Instant,
    timings: crate::PhaseTimings,
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
        session: crate::cookies::Session,
        media: MediaEnvironment,
        request: std::time::Duration,
    ) -> std::result::Result<Self, crate::NavigationFailure> {
        use crate::{NavigationFailure as Failure, NavigationStage as Stage};
        let started = std::time::Instant::now();
        transport
            .check_deadline()
            .map_err(|error| Failure::new(Stage::Initialization, error))?;
        let deadline = transport.deadline;
        let cancellation = transport.cancellation.clone();
        let machine = Machine::new(
            &response.body,
            &response.url,
            transport.limits,
            Arc::new(move || {
                cancellation.check()?;
                if std::time::Instant::now() >= deadline {
                    Err(Error::Limit("navigation deadline"))
                } else {
                    Ok(())
                }
            }),
            true,
            session,
            media,
        )
        .map_err(|error| Failure::new(Stage::Initialization, error))?;
        let epoch = std::time::Instant::now();
        let mut page = Self {
            machine: RefCell::new(machine),
            transport,
            url: response.url,
            epoch,
            timings: crate::PhaseTimings {
                request,
                initialization: epoch.saturating_duration_since(started),
                execution: std::time::Duration::ZERO,
            },
        };
        let failed = |error| {
            let mut failure = Failure::new(Stage::Execution, error);
            failure.execution_phase = Some(page.execution_phase());
            failure
        };
        if page.drive().map_err(failed)?.is_some() {
            return Err(failed(Error::Unsupported("unexpected load result".into())));
        }
        page.timings.execution = epoch.elapsed();
        Ok(page)
    }

    /// URL final após redirects autorizados.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Returns an explicit snapshot of this page's resources and `QuickJS` heap accounting.
    /// Reading counters does not execute guest JavaScript or reset page budgets.
    #[must_use]
    pub fn diagnostics(&self) -> crate::Diagnostics {
        self.machine.borrow().diagnostics()
    }

    /// Returns the phase durations measured while this page was navigated.
    #[must_use]
    pub const fn timings(&self) -> crate::PhaseTimings {
        self.timings
    }

    /// Reads the scheduler state without executing JavaScript or resetting budgets.
    /// After failure or cancellation, this remains the last scheduler state.
    #[must_use]
    pub fn execution_phase(&self) -> crate::ExecutionPhase {
        self.machine.borrow().execution_phase()
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
                    self.transport.wait(
                        std::time::Duration::from_secs_f64(milliseconds / 1000.0).min(remaining),
                    )?;
                }
                Action::Request {
                    url,
                    method,
                    body,
                    binary,
                    options,
                } => match self
                    .transport
                    .request(&base, &url, &method, &body, binary, &options)
                {
                    Ok(response) => self.machine.borrow_mut().respond(response)?,
                    Err(error @ (Error::Limit(_) | Error::Cancelled)) => return Err(error),
                    Err(error) => self.machine.borrow_mut().reject(&error.to_string())?,
                },
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

    /// Wait for a selector, synchronous boolean predicate or quiet network interval.
    /// Timers, microtasks and HTTP continue under the original page budgets.
    ///
    /// # Errors
    /// Returns an error for invalid conditions, JavaScript failures or exceeded budgets.
    pub fn wait_for(&self, readiness: &crate::Readiness) -> Result<()> {
        self.transport.check_deadline()?;
        {
            let mut machine = self.machine.borrow_mut();
            machine.advance(self.epoch.elapsed().as_secs_f64() * 1000.0)?;
            machine.wait_for(readiness)?;
        }
        if self.drive()?.is_some() {
            return Err(Error::Unsupported("unexpected readiness result".into()));
        }
        Ok(())
    }
}
