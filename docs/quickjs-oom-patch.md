# QuickJS heap exhaustion

`Cargo.toml` overrides `rquickjs-sys` 0.14.0 with the copy in
`vendor/rquickjs-sys`. Its source is the crates.io package with SHA-256
`cee271d0eeba64f0915b846cb7ae02e16faf3dfdffdca91731101d9d30fe3423`.
Registry cache metadata is omitted. The license is copied from upstream revision
`d7ef5eeae702fea24c03643064de454f1c1dd4b0`. Generated Rust bindings, the build script,
Wasm libc and the other upstream sources are unchanged.

The patch changes only `quickjs/quickjs.c`. The original engine can exhaust its
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

Remove the override when the resolved upstream dependency preserves an
identifiable fatal out-of-memory failure even when exception allocation fails.
Keep the native and Wasm regressions when verifying that replacement.
