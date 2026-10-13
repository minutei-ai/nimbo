# Worker client cancellation

The Worker passes the incoming `Request.signal` to Effect's native executor.
Interrupting the scoped extraction aborts pending HTTP operations and sleep,
then releases the owned Rust/Wasm page, cookie transport and isolate semaphore.
No page JavaScript is executed in the Worker host and no second browser is used.

Cloudflare requires the `enable_request_signal` compatibility flag. Nimbo's
Alchemy configuration enables it explicitly. Other Worker hosts must propagate
client disconnects to the incoming signal. See the
[Cloudflare request cancellation documentation](https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/).

The regression uses the actual workerd HTTP listener. It confirms entry through
an origin HTTP marker before disconnecting the client, then checks that another
extraction succeeds within two seconds with fresh page state. The four cases
cover a guest timer, pending HTTP response, partial response body and readiness
predicate. Before the fix, the recovered extraction returned 429 because the
abandoned extraction still occupied the semaphore.

The shared DOM, JavaScript fuel, request, byte and deadline limits continue to
apply. This change cancels asynchronous host waits. An incoming abort cannot
preempt a synchronous guest call before control returns to the host; its engine
budgets remain responsible for bounding that call. Cancellation does not reset
limits or retry requests.

The HTTP client has disconnected, so no successful extraction response is
promised for the interrupted request. Explicit cancellation of native `Browser`
and `Page` operations, cancellation diagnostics and broader resource/session
lifecycle tests remain roadmap work.

```sh
bun run build:worker
bun test tooling/worker-cancellation.test.ts
```
