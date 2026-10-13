# Worker binary response memory

Binary HTTP responses cross the Worker/Wasm boundary as `Uint8Array` bytes and
small JSON metadata. The host does not expand bytes into a numeric JSON array.
`WasmPage.respond_binary` consumes the received Rust `Vec<u8>`; the shared
machine transfers its ownership to QuickJS's safe `ArrayBuffer` constructor.
This removes the second Rust response-buffer copy. Text responses keep their
existing protocol. Response byte budgets, origin checks and page isolation are
unchanged. The original serialized response API remains available.

[Local evidence](evidence/worker-binary-memory-local.json) records a synthetic
single-isolate run on celld 0.6.1. Each extraction fetches deterministic bytes
(`index % 251`) and verifies length and both endpoints. Payloads are 65,536,
1,048,576, 1,900,000, 1,900,000 and 65,536 bytes, sequentially. All five
extractions succeed in both builds at the original default limits.

Both builds start with 6,684,672 bytes of Wasm linear memory. After the largest
response the baseline reaches 24,379,392 bytes and the candidate reaches
13,762,560 bytes: 43.55% less capacity in this workload. Repeating the large
response and returning to the small response do not grow either memory further.
Wasm memory does not shrink when pages are released, so this is a retained
capacity measurement, not live allocations, allocator peak or total Worker
memory. It does not establish production capacity or a latency improvement.

The probe is deliberately outside the deployed Worker: an instrumented local
bundle retains `initSync({ module: wasm }).memory` and reads
`memory.buffer.byteLength` between extractions. One isolate is enforced with
`CELLD_MAX_STATELESS_ISOLATES=1`. Measurements require the source/bridge matching
each Wasm artifact. Never expose a measurement route in the deployed handler.
The evidence includes Wasm hashes; the probe's temporary bundle is not a release
artifact. Controlled repeat runs and allocator/host measurements remain open.

Alchemy continues to own the Worker configuration, compatibility flags and
secret bindings. The memory reduction happens in Nimbo's Rust/Wasm protocol.
The configured local development entry point is `bun run dev:worker`; it needs
a usable Cloudflare profile. Engine tests also run directly in workerd without
deploying a Cloudflare resource.
