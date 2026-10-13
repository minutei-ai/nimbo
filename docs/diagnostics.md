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
Rust DOM/font/layout memory, Wasm linear capacity or host process memory.
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
