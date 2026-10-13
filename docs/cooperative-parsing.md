# Cooperative initial HTML parsing

`WasmPageLoader` retains Nimbo's native html5ever tokenizer, UTF-8 decoder and
counted tree sink between calls. Each `feed` accepts at most 8 KiB and shares the
existing response-byte and initial/cumulative node budgets. `finish` transfers
the owned document and allocation count into the Rust/QuickJS machine without
cloning its arena. The existing synchronous `WasmPage` constructor remains
available; the Worker uses the incremental loader.
Initial documents and replacement fragments use one concrete counted tree sink,
avoiding duplicate html5ever tree-builder code in the Wasm artifact.

The Worker uses one reusable 8 KiB UTF-8 buffer and preserves surrogate pairs
across string windows. Native ancestry requests a host yield for deep trees;
the Worker yields after every such block. Shallow input yields after at most
128 KiB and after the final multi-block batch. The installed asynchronous Effect
scheduler dispatches these yields through a host timer, allowing the original
request deadline and disconnect signal to be processed.

The loader and page have separate scoped disposal. A timeout or disconnect
before completion releases the partial document and its session references;
the next extraction gets fresh page state. Scripts are queued only after the
document is transferred into its machine.
A failed feed permanently closes its loader and immediately releases its partial
arena. Direct workerd tests verify chunk/total-byte/node limits, ownership transfer
after loader disposal and the existing synchronous constructor.

Real workerd HTTP regressions cover a 60,000-level tree, deadline rejection,
fresh-page recovery, client disconnection and admission control during parsing.
UTF-8 tests split a surrogate pair at the host window boundary. Native tests
cover byte-by-byte decoding, recovery, quotas, ancestry hints and document
release after a parser failure.

[The local deadline probe](evidence/cooperative-parser-deadline-local.json)
records the former 32,768-level extraction returning success after about 15
seconds despite the 10-second deadline. The candidate rejects that extraction
and the next small extraction succeeds in the same isolate. Lower retained
capacity in a rejected request is resource-boundary evidence, not an optimization
on equivalent supported work.

[The local corpus comparison](evidence/cooperative-parser-corpus-local.json)
records all raw samples and unchanged predeclared tolerances. All 1,404 attempted
extractions passed, including warmups, but local latency regression flags remain
unresolved. Isolated probes do not replace that corpus gate. Controlled-runner
performance acceptance remains open; this change claims no latency improvement.

This is cooperative cancellation between native calls. An individual tokenizer
operation and machine initialization remain synchronous; the deadline can
overshoot by work already executing. Synchronous fragment writes and other
long native operations still require separate profiling and hardening.
Cloudflare [timers do not advance during CPU execution](https://developers.cloudflare.com/workers/runtime-apis/scheduler/).
Local workerd evidence and live Cloudflare validation remain separate.
