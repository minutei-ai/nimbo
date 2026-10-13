use serde::{Deserialize, Serialize};

/// A bounded page condition checked before extraction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReadyCondition {
    /// Wait until the document contains a matching element.
    Selector {
        /// CSS selector evaluated against the current document.
        selector: String,
    },
    /// Wait until a synchronous JavaScript expression returns true.
    Predicate {
        /// Boolean expression evaluated in the page's context.
        expression: String,
    },
    /// Wait for a continuous interval with no engine HTTP requests.
    NetworkIdle {
        /// Quiet interval in milliseconds, starting after the latest request.
        #[serde(rename = "quietMs")]
        quiet_ms: u32,
    },
}

/// Readiness options share the page's original deadline and resource budgets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Readiness {
    /// Condition that must be met before extraction starts.
    pub condition: ReadyCondition,
    /// Maximum waiting time in milliseconds, from 1 through 10,000.
    pub timeout_ms: u32,
    /// Predicate/selector polling interval in milliseconds, from 1 through 1,000.
    pub poll_interval_ms: u32,
}

impl Readiness {
    pub(crate) fn validate(&self) -> crate::Result<()> {
        if !(1..=10_000).contains(&self.timeout_ms) || !(1..=1000).contains(&self.poll_interval_ms)
        {
            return Err(crate::Error::Limit("invalid readiness configuration"));
        }
        if let ReadyCondition::NetworkIdle { quiet_ms } = self.condition
            && (quiet_ms == 0 || quiet_ms > self.timeout_ms)
        {
            return Err(crate::Error::Limit("invalid network idle interval"));
        }
        Ok(())
    }
}

pub(crate) struct Waiting {
    pub test: Option<rquickjs::Persistent<rquickjs::Function<'static>>>,
    pub deadline: f64,
    pub next_poll: f64,
    pub interval: f64,
    pub quiet: Option<f64>,
    pub idle_since: Option<f64>,
}
