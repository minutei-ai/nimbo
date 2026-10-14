use crate::{Error, ExecutionPhase};

/// The native operation active when a navigation failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum NavigationStage {
    /// Initial cancellation and deadline validation.
    Validation,
    /// Destination validation, redirects and response transfer.
    Request,
    /// Validation of the final response status and content type.
    Response,
    /// HTML parsing, DOM construction and JavaScript runtime initialization.
    Initialization,
    /// Script execution and document lifecycle delivery.
    Execution,
}

impl NavigationStage {
    /// A fixed label containing no destination or page data.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Validation => "validation",
            Self::Request => "request",
            Self::Response => "response",
            Self::Initialization => "initialization",
            Self::Execution => "execution",
        }
    }
}

/// An opt-in native navigation failure with operation and scheduler context.
/// The original error remains available; its message may contain destination data.
#[derive(Debug, thiserror::Error)]
#[error("navigation {}: {error}", stage.as_str())]
#[non_exhaustive]
pub struct NavigationFailure {
    /// The native operation that failed.
    pub stage: NavigationStage,
    /// Last scheduler state, when initialization completed before the failure.
    pub execution_phase: Option<ExecutionPhase>,
    /// Original navigation error, without replacement or message classification.
    #[source]
    pub error: Error,
}

impl NavigationFailure {
    pub(crate) fn new(stage: NavigationStage, error: Error) -> Self {
        Self {
            stage,
            execution_phase: None,
            error,
        }
    }
}
