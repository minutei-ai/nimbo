use serde::Serialize;

/// An explicit resource snapshot of one owned page, without page content or host secrets.
/// `QuickJS` byte counts describe its runtime; they are not peak or total process memory.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Diagnostics {
    /// Bytes tracked by `QuickJS`'s allocator at the time of the snapshot.
    pub javascript_allocated_bytes: i64,
    /// Used bytes reported by `QuickJS`'s heap accounting, including external buffers.
    pub javascript_used_bytes: i64,
    /// JavaScript objects reported by `QuickJS`'s heap accounting.
    pub javascript_object_count: i64,
    /// Interrupt fuel consumed under the page's existing JavaScript budget.
    pub javascript_ticks_used: usize,
    /// Pending JavaScript jobs executed by the machine.
    pub microtasks_executed: usize,
    /// DOM work charged to the page's existing operation budget.
    pub dom_operations: usize,
    /// Bytes charged to the page's existing DOM write budget.
    pub dom_write_bytes: usize,
    /// Native node and attribute handles retained by the page.
    pub dom_handle_count: usize,
}
