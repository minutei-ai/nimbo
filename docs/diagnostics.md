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
the ordinary semantics. Timing samples and transient peaks remain separate
roadmap work.

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
Schema version 2 also records the single workerd process's current RSS and
[kernel RSS high water](worker-rss-high-water.md), separately from the summed
post-response host samples.

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

## Failure and cancellation phases

After a valid authenticated request enables `diagnostics`, a failed Worker
response includes a separate diagnostic shape:

```json
{
  "error": "resource limit: readiness deadline",
  "diagnostics": {
    "phase": "readiness",
    "enginePhase": "waiting",
    "cancelled": false
  }
}
```

`phase` records the host operation: `navigation`, `parsing`, `initialization`,
`execution`, `resource`, `readiness`, `extraction` or `serialization`. A resource
request temporarily enters `resource`, then returns to its calling operation
when the response or recoverable rejection is delivered. Failures before input
validation completes cannot enable optional diagnostics. Authentication and
capacity rejections retain their existing response shapes.

`enginePhase`, when a page exists, records the owned scheduler state:
`scripts`, `lifecycle`, `ready`, `waiting` or `evaluating`. It is read during
scoped finalization before freeing the page. For example, a synchronous
extraction can throw while the scheduler remains `ready`; a rejected extraction
promise fails in `evaluating`. This read does not walk the heap or execute guest
code. Failed responses do not attempt heap snapshots of an interrupted runtime.

Native callers can read `Page::execution_phase()` and
`ExecutionPhase::as_str()`, including after readiness failure or cancellation.
Existing `Error` variants and budget behavior are preserved.
`Browser::navigate_with_diagnostics(url, &cancellation)` additionally returns
`NavigationFailure` when navigation cannot produce a page. Its `stage` is
`validation`, `request`, `response`, `initialization` or `execution`. Request
covers destination checks, redirects and HTTP transfer; initialization covers
HTML/DOM parsing and runtime creation. `execution_phase` is present after
initialization and retains the last owned scheduler state before page disposal.
`stage.as_str()` and `execution_phase.map(ExecutionPhase::as_str)` provide fixed
labels for callers. The original `error` remains available as an error source;
its existing message can include destination data. Nimbo adds no automatic logs,
heap walks, timing samples or budget changes to this API. `navigate` and
`navigate_with_cancel` keep returning their original `Error` values.

Native real-HTTP tests cover blocked destinations, status/content rejection,
initial DOM limits, script and lifecycle fuel exhaustion, early cancellation
and cancellation during a partial HTTP body. Fresh navigation verifies cleanup
after failure; scalar phase capture requires no surviving failed Page.
The native labels describe operation boundaries; headers versus bodies,
individual initialization steps and subresource timing remain separate work.

A host timeout retains HTTP 504 and reports `cancelled: false`.
Unexpected internal defects return HTTP 500 with a generic error message.
Client interruption is represented internally by HTTP 499 and `cancelled: true` after
all scope finalizers run. A disconnected client cannot receive that response.
For opted-in requests, the Worker also emits one structured console record with
event `nimbo.scrape.cancelled` and those phase diagnostics. It includes no URL,
expression, credentials, page content or raw error cause. Without the flag,
there is no cancellation record and ordinary error responses omit diagnostics.

Real HTTP/workerd tests cover navigation, node limits, inline scripts, failed
imports, synchronous and rejected extraction, readiness deadlines and host
timeouts. Actual listener disconnects verify phase records during timer, HTTP,
partial-body, readiness and incremental-parser waits, followed by fresh-page
recovery. Wider lifecycle cases and timing profiles remain roadmap work.

The installed QuickJS wrapper exposes allocation interception through an unsafe
allocator trait, while this engine forbids unsafe Rust. The current safe runtime
API supplies heap snapshots and has no allocator peak counter. Snapshot maxima
must not be reported as a true transient allocation peak; that gate remains open.
