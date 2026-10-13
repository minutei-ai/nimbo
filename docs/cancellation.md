# Cancellation

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
promised for the interrupted request.

Native callers can create a `CancellationToken` and pass it to
`Browser::navigate_with_cancel`. Clones share an irreversible signal; cancelling
from another thread also interrupts subsequent evaluation and readiness on that
page. A cancelled operation returns `Error::Cancelled`. Normal `navigate`
creates a fresh signal, so cancelling one page does not cancel the browser's
next navigation. Session cookies and storage retain their ordinary semantics.

The synchronous native API drives reqwest's asynchronous client on a shared
current-thread Tokio runtime. Cancellation drops the pending HTTP future,
including partially received bodies, and wakes timer waits. QuickJS checks the
same signal through its interrupt handler and DOM operation checks. The tests
observe socket closure for pending headers and partial bodies, then recover on
the same browser; they also cover timers, infinite JavaScript, readiness and
pre-cancelled signals. Cancellation diagnostics and broader resource/session
lifecycle tests remain roadmap work.

```sh
bun run build:worker
bun test tooling/worker-cancellation.test.ts
cargo test --locked -p nimbo-engine --test cancellation
cargo test --locked -p nimbo-engine --test browser cancellation
```
