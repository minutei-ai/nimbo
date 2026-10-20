# QuickJS embedding patches

`Cargo.toml` overrides `rquickjs-sys` 0.14.0 with the copy in
`vendor/rquickjs-sys`. Its source is the crates.io package with SHA-256
`cee271d0eeba64f0915b846cb7ae02e16faf3dfdffdca91731101d9d30fe3423`.
Registry cache metadata is omitted. The license is copied from upstream revision
`d7ef5eeae702fea24c03643064de454f1c1dd4b0`. Generated Rust bindings and Wasm libc are unchanged. The build script tracks
the copied C/header inputs so a source change recompiles the native library.

## Heap exhaustion

The original engine can exhaust its
heap while constructing the out-of-memory exception and fall back to throwing
`null`. A host cannot distinguish that failure from a page's `throw null`.
Reporting both as ordinary page exceptions would hide resource exhaustion.

Each context reserves one out-of-memory error during intrinsic initialization.
Allocation failures reuse that object without allocating, including the fallback
in the ordinary error constructor. The error is uncatchable and is marked and
freed with its owning context. Nimbo's existing safe QuickJS API identifies the
native fatal flag; its Rust unsafe-code policy and heap ceiling stay intact.

The native and Worker regressions require script exceptions to report window
errors and allow later scripts to execute. Resource failures must still reject
navigation and leave fresh pages usable. Native regressions also require a
page's `throw null` and `new Error('out of memory')` to remain ordinary exceptions.

## Dynamic module loading

The resolved QuickJS loader returns synchronously. Its dynamic-import job rejects
an uncached source before the host can fetch it. The C patch adds a context-owned
preload barrier to that job. The embedding obtains and deletes the one-shot setup
function before guest code runs. The callback is marked and freed with its context;
page scripts cannot replace the stored callback by assigning a global property.

The native resolver checks import attributes and origin policy and normalizes the
requested module once. The host queues that exact URL and discovers its static
graph with the existing compiler and bounded request transport. Concurrent imports
of the same URL share the pending preload. Once sources are ready, the original
native import Promise continues through QuickJS's module map and evaluation;
source code and root side effects are never replayed. Internal Promise reactions
use the native await machinery without invoking guest Promise species constructors.
HTTP/MIME failures reject the import and allow a subsequent network attempt.
Native syntax and evaluation failures retain their engine error values.

Pending preload handles are cleared before the page context/runtime is released,
including interruption and fatal request limits. The Rust unsafe-code policy,
request/response budgets, heap ceiling and per-page module ownership remain intact.
The regressions use real HTTP and workerd, with an independent ordinary Chromium
comparison for namespace identity, live exports, metadata and single execution.
JSON modules and complete HTML module lifecycle conformance remain unsupported.

Remove the override when the resolved upstream dependency supports both identifiable
fatal out-of-memory failures and asynchronous dynamic loading with these identity,
normalization and lifetime contracts. Keep the native and Wasm regressions when
verifying that replacement.
