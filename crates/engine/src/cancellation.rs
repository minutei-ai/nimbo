use crate::{Error, Result};
use tokio::sync::watch;

/// A thread-safe, irreversible cancellation signal shared by native operations.
/// Clones address the same signal; cancellation never resets page budgets.
#[derive(Clone, Debug)]
pub struct CancellationToken(watch::Sender<bool>);

impl Default for CancellationToken {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}

impl CancellationToken {
    /// Creates a signal that has not been cancelled.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancels every operation using this signal. Repeated calls are harmless.
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }

    /// Returns whether cancellation has been requested.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    pub(crate) fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }

    pub(crate) async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        // This token retains its sender; a closed channel is also a stop condition.
        let _outcome = receiver.wait_for(|cancelled| *cancelled).await;
    }
}
