# Bounded page readiness

The Rust machine supports three readiness conditions on native and Worker hosts.
Readiness begins after navigation/lifecycle and before the extraction expression.
Timers, microtasks, modules, fetch and stylesheet loading continue in the owned
engine. Waiting does not reset the original navigation deadline, JavaScript fuel,
microtask, timer, request, DOM or heap budgets.

For `POST /scrape`, add `waitFor`:

```json
{
  "url": "https://example.com",
  "expression": "document.querySelector('#result').textContent",
  "waitFor": {
    "condition": { "type": "selector", "selector": "#result" },
    "timeoutMs": 1000,
    "pollIntervalMs": 10
  }
}
```

The other conditions are:

```json
{ "type": "predicate", "expression": "globalThis.appLoaded === true" }
```

```json
{ "type": "networkIdle", "quietMs": 100 }
```

Selectors check existence in the current document, without a visibility test.
Predicates are synchronous expressions returning a boolean. Exceptions,
non-booleans and Promises fail explicitly; predicates run in the page context
and should avoid side effects. The predicate is compiled once per wait.

Network idle means no engine HTTP requests during a continuous quiet interval.
Its clock starts when the wait first observes an empty request queue and restarts
after each subsequent request completes or fails. This covers the machine's
in-flight fetch/module/stylesheet/script requests, including concurrent async
scripts. It does not predict requests
from future timers or establish that an application has finished rendering.
The polling interval applies to selectors and predicates; network idle sleeps
until the next timer, quiet-window boundary or waiting deadline.

`timeoutMs` must be 1–10,000; `pollIntervalMs` must be 1–1,000. Both are required.
`quietMs` must be positive and no greater than `timeoutMs`. The original page
deadline may expire sooner. `scripts: "skip"` still skips page scripts when
readiness is requested. A never-satisfied condition fails with
`resource limit: readiness deadline` (HTTP 422 on the Worker), and the Worker
disposes the page and releases capacity. Schema-invalid options return HTTP 400.
The overall Worker deadline remains HTTP 504.

Native callers use the same condition and budgets:

```rust,no_run
use nimbo_engine::{Browser, Limits, Readiness, ReadyCondition};

# fn main() -> Result<(), Box<dyn std::error::Error>> {
let browser = Browser::new("https://example.com", Limits::default())?;
let page = browser.navigate("https://example.com")?;
page.wait_for(&Readiness {
    condition: ReadyCondition::Selector { selector: "#result".into() },
    timeout_ms: 1000,
    poll_interval_ms: 10,
})?;
let value = page.evaluate("document.querySelector('#result').textContent")?;
# Ok(())
# }
```

A native page whose wait fails should be disposed. Repeated successful waits are
supported while the original page deadline remains available. The Wasm ABI
exposes `WasmPage.wait_for(serialized_options)`; hosts continue the existing
`step`/`advance` protocol until `ready` and then evaluate. Request actions carry
an ID; `respond`, `respond_binary` and `reject` take that ID before their response
arguments. An `await` action waits for a request completion or its optional timer
delay. Only the engine decides when parser execution can continue.

Real HTTP regressions run in native browser tests and `tooling/readiness.test.ts`
against Worker/Wasm in workerd. See [cancellation](cancellation.md) for external
cancellation and the remaining limits of synchronous guest execution.
