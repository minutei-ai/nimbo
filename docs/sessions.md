# Sessions

## Model

On native hosts a session is one `Browser`. It owns one authorized origin, one
optional explicit proxy, one HTTP client pool, one cookie jar and one Web
Storage area pair (local and session storage). Every navigation and page
subrequest from that `Browser` reads and writes the same jar and storage. Two
`Browser` values never share state, even with the same origin. A tenant is
isolated by giving it its own `Browser`, and a `Browser` must not be shared
across tenants.

`Browser` and `Page` are neither `Send` nor `Sync`. One session runs on one
thread, so its operations cannot overlap in parallel. Several live `Page`s
from the same `Browser` may interleave on that thread. They see each other's
cookie and storage writes in program order, and the last write wins. Each page
keeps its own DOM, JavaScript runtime, budgets and deadline.

The Worker host has no persistent session. Each `/scrape` request builds a
fresh transport, cookie jar and page, then discards all of them. Cookies from
redirects and subrequests apply only within that request. Persistent Worker
sessions stay out of scope until the semantics below can be met there
with tenant-bound storage.

## Lifetime and expiry

- **Cookie expiry:** `Max-Age`, `Expires` and deletion cookies are applied when
  each request and `document.cookie` read is made.
- **Session end:** `Browser::clear_session` empties cookies and Web Storage in
  place. Pages that are still alive observe the empty session, and later
  requests carry no cookies. Dropping the `Browser` also ends the session.
- **Host expiry policy:** idle or absolute session lifetimes are host policy.
  A host enforces them by calling `clear_session` or dropping the `Browser`.
  The engine keeps no clock-based session timers.

## Cancellation and failure

Cancellation and deadlines end the active navigation or evaluation with
`Error::Cancelled` or a limit error and release its sockets. The session
survives. Response headers already received, including `Set-Cookie`, stay
committed, as in browsers, and the next navigation on the same `Browser`
succeeds. A failed navigation never returns a partial page.

## Phase timings

`Page::timings` returns the wall-clock durations of request (validation,
redirects, transfer), initialization (parsing, DOM, runtime) and execution
(parser scripts, lifecycle). Reading them is explicit and returns durations
only: no URLs, page contents, headers or credentials. Worker failures report
their host phase through the [diagnostics flag](diagnostics.md).

## Evidence

`crates/engine/tests/sessions.rs` runs a real HTTP origin and covers:

- persistence across navigations, with no leakage to another `Browser`
  (tenant isolation);
- interleaved pages on one session;
- `clear_session` seen by a live page and by later requests;
- cookie deletion;
- cancellation of a stalled response with session recovery;
- phase timings.

Proxy credentials stay in transport and never reach pages or origins
([proxy fixture](../tooling/native-proxy-fixture.py)). Each fuzzing input must
leave a fresh page with no leaked globals, storage or cookies
([fuzzing](fuzzing.md)). Load behavior is in [load testing](load-testing.md).
