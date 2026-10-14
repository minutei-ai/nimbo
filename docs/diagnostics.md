# Optional page diagnostics

Native callers request a snapshot with `Page::diagnostics()`. Worker callers
add `"diagnostics": true` to an authenticated `/scrape` request; a successful
response then includes a `diagnostics` object beside the extraction value.
Omitting the flag or passing `false` preserves the ordinary response shape.
The flag accepts only booleans and is validated before origin HTTP requests.

The shared machine uses rquickjs's safe `Runtime::memory_usage()` API and the
resource counters already used to enforce page budgets. All fields are numbers:

| Field                      | Meaning                                                |
| -------------------------- | ------------------------------------------------------ |
| `javascriptAllocatedBytes` | Bytes currently tracked by QuickJS's allocator         |
| `javascriptUsedBytes`      | Used bytes reported by QuickJS's heap accounting       |
| `javascriptObjectCount`    | Objects reported by QuickJS's heap accounting          |
| `javascriptTicksUsed`      | Interrupt fuel consumed from the existing page budget  |
| `microtasksExecuted`       | JavaScript jobs charged to the microtask budget        |
| `domOperations`            | Work charged to the DOM operation budget               |
| `domWriteBytes`            | Bytes charged to the DOM write budget                  |
| `domHandleCount`           | Native node and attribute handles retained by the page |

These are current page-runtime snapshots. They do not measure peak allocations,
Rust DOM/font/layout memory or host process memory.
QuickJS's used-byte accounting includes external ArrayBuffer storage, so its
used bytes can exceed its allocator-tracked bytes. A heap snapshot walks the
runtime's objects; it is performed only on explicit request and does not run
garbage collection, reset budgets or execute additional page JavaScript.

Diagnostics contain resource counts, rather than page contents, URLs or host
configuration. The guest realm has no diagnostics binding. Each fresh page
starts with its own runtime and counters. Worker diagnostics are collected
after extraction, before disposing the owned page; the extraction value retains
the ordinary semantics. Timing samples, transient peaks and diagnostics for
failed navigation remain separate roadmap work.

Worker responses also include `wasmLinearBytesBefore` and `wasmLinearBytes`:
the isolate's linear-memory capacity before navigation and at extraction,
respectively. These reads use the memory returned by the generated `initSync`
contract; no instrumented bundle or extra HTTP route is needed. The fields are
absent from native snapshots. Capacity is shared by consecutive pages in one
isolate and does not shrink when a page is freed. It includes allocator storage
and free space, so it must not be added to QuickJS bytes or described as live
page memory, total Worker memory or a transient allocation peak.

`bun run profile:worker-memory` measures three fresh workerd hosts, each with
one isolate and four sequential extractions at the artifact's original defaults.
It verifies a 256 KiB HTML text node and small/16 MiB/repeated 16 MiB/small
JavaScript buffers, recording heap snapshots, linear capacity and process-tree
RSS sampled after each response. RSS is nullable when the complete process tree
cannot be read; it is neither a per-page measurement nor a peak. The report
includes bundle/Wasm hashes, budgets and host versions. Diagnostic heap walks
add overhead, so this profile is separate from latency acceptance benchmarks.

[Local raw evidence](evidence/worker-memory-profile-local.json) records twelve
successful extractions across three fresh hosts. Each round reports 630,832
QuickJS used bytes for both small pages and 17,408,365 bytes for both large
pages. Wasm capacity grows from 6,750,208 bytes before the first navigation to
26,869,760 bytes after the first large page, then remains at that capacity.
The sampled process-tree RSS increases during each sequence despite the fresh
page heap recovering. These results establish the difference between the
measurements; they are not an A/B memory reduction, a controlled-runner gate
or evidence of production capacity.

The Worker drops its reference to the decoded navigation HTML immediately after
the loader consumes its final block. Scripts, subresources and readiness waits
retain the native DOM rather than the original host string. This makes the
string eligible for host garbage collection; it does not force a collection
or promise an immediate RSS reduction.
