# Browser coverage and acceptance

The target is the union of Kitesurf's public contracts, Obscura's public
contracts, and the capabilities Kitesurf explicitly excludes. Prefer the
Worker/Wasm engine. Provision resources through Alchemy. A different runtime
requires a measured reason for the particular capability; Alchemy provisions
resources but does not change the Worker runtime's APIs.

This inventory is an implementation backlog, not a parity claim. An upstream
method name, successful protocol acknowledgement, or existing JavaScript global
does not prove that the behavior works. Undocumented behavior is unknown rather
than assumed unsupported. Full browser conformance needs pinned upstream WPT
tests as well as integration and application tests.

## Current evidence

`tooling/browser-live.test.ts` uses a real loopback HTTP origin, actual workerd,
and the compiled Rust/Wasm engine. It installs no transport replacements,
service mocks, browser API stubs, or canned engine results. Its 64 data variants
exercise external scripts, Unicode/entity decoding, selector identity,
ancestry, removal/reparenting, attribute mutation and POST response decoding.
These are repeated integration checks, not 64 independent platform features.

To compare the same pages and expected values with an installed Obscura binary,
set `NIMBO_COMPARE_OBSCURA_BINARY` when running
`bun test tooling/browser-live.test.ts`. Without that variable the suite tests
Nimbo only. The comparison executes the validation as page script, waits for
Obscura's `networkidle0`, and reads a completed value; it does not rely on the
CLI awaiting a Promise returned by `--eval`. Record the binary's version
separately; an installed release is not necessarily the audited source revision.

CI downloads the public `v0.2.3` Linux render build, checks its published SHA-256,
and runs this comparison after the complete local check. The release revision
and artifact digest are in the contract inventory, separate from the audited
upstream revision. An earlier `0.2.2` binary failed reflexive `contains`;
`v0.2.3` passes that case. Nimbo keeps the standards-based expectation instead
of reproducing a baseline defect.

The existing native Rust integration suite also uses a real HTTP listener.
The older `tooling/worker.test.ts` suite includes callback-based transport
fixtures. Those checks remain useful for boundary failures but do not count as
mock-free transport evidence. Neither local suite proves deployed performance,
TLS fingerprints, rendering or broad browser compatibility.

## Capability matrix

`Subset` means only the currently tested operations. `Missing` means there is no
implementation providing the listed behavior. `Unverified` means the current
evidence cannot establish it.

| Capability                                            | Nimbo      | Required acceptance evidence                                                      |
| ----------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| HTML parsing, entities, selector queries              | Subset     | HTML and selector WPT cases, malformed input, namespaces                          |
| DOM mutation, identity and ancestry                   | Subset     | Live mutation results, detached nodes, tree-cycle rejection, WPT                  |
| Node/Text/Comment/Fragment, live collections          | Missing    | Node types, insertion/replacement, collection liveness                            |
| Event dispatch and lifecycle                          | Subset     | Capture/bubble, cancellation, once/passive, native input ordering                 |
| Classic scripts and Promise jobs                      | Subset     | Source ordering, exception propagation, resource exhaustion                       |
| Modules, import maps, JSON modules, dynamic import    | Missing    | Real dependency graphs, redirects, cycles and async evaluation                    |
| Timers, animation frames and scheduling               | Missing    | Clock-based ordering, cancellation, idle and deadline behavior                    |
| Custom elements and Shadow DOM                        | Missing    | Upgrade lifecycle, slots, composed paths, isolation                               |
| Frames and independent execution worlds               | Missing    | Same/cross-origin frames, navigation, world isolation                             |
| Fetch and HTTP navigation                             | Subset     | Real GET/POST, cookies, redirects, bodies; full headers/abort/streams             |
| XMLHttpRequest, forms, files and binary responses     | Missing    | Real uploads/downloads, encodings, progress and cancellation                      |
| CORS, CSP, mixed content and origin policy            | Subset     | Current same-origin restriction is not a browser policy implementation            |
| Network interception, response fulfillment, blocking  | Missing    | Actual request pause/continue/fail/fulfill and event/body correlation             |
| Cookies and per-navigation isolation                  | Subset     | Path/domain/expiry/Secure/HttpOnly/SameSite, independent contexts                 |
| Persistent sessions, cookies and storage              | Missing    | Restart/eviction recovery and tenant isolation via durable state                  |
| localStorage/sessionStorage/IndexedDB                 | Missing    | Origin isolation, transactions, persistence and quota failures                    |
| URL, encoding, streams, File APIs and WebCrypto       | Missing    | Pinned WPT with actual algorithms and binary round trips                          |
| Page WebAssembly and Web Workers                      | Missing    | Guest modules, imports, worker messages, termination and isolation                |
| CSS cascade, CSSOM, typed styles, layout and geometry | Missing    | Computed styles and shared layout driving queries and paint                       |
| Fonts, images, SVG and Canvas 2D                      | Missing    | Resource loading, shaping, raster output and pixel comparisons                    |
| Screenshots, PDF and screencasts                      | Missing    | Real paint output, pagination, frame changes and backpressure                     |
| Accessibility tree and snapshots                      | Missing    | Roles, names, hidden nodes, state changes and stable references                   |
| Mouse, keyboard, focus, selection and scrolling       | Missing    | Hit-testing, trusted host input and resulting page behavior                       |
| Browser/target/context lifecycle and CDP              | Missing    | Real client connections, objects, events and context isolation                    |
| Puppeteer/Playwright/DevTools compatibility           | Missing    | Unmodified clients navigating and interacting with fixtures                       |
| MCP navigation, reading, actions and diagnostics      | Missing    | Real MCP transports, page state and authenticated remote use                      |
| Markdown, links, structured extraction and crawling   | Subset     | Current JS extraction only; native outputs and real crawl jobs missing            |
| CLI batch scraping and library API                    | Subset     | Existing single-page CLI/library; bounded batches and cancellation                |
| HTTP/CONNECT and SOCKS proxy support                  | Missing    | Generic authenticated proxy integration; no operational config in source          |
| TLS fingerprint and transport control                 | Unverified | Capture ClientHello/ALPN and verify scripted subrequests use the same transport   |
| WebGL and GPU-dependent pages                         | Missing    | Actual shader execution and pixels; software rendering must be labelled           |
| Audio/video playback and codecs                       | Missing    | Decode real media, advance playback and produce frames/samples                    |
| Challenge-dependent authentication                    | Unverified | Real authorized source behavior, with challenge failure explicit                  |
| Browser profiles and stealth surfaces                 | Missing    | Consistency with implemented behavior and measured transport; no fake API success |
| SSRF protections and resource budgets                 | Subset     | Resolved-address policy, private IPv4/IPv6, limits and recovery                   |
| Metrics, concurrency, deployment and recovery         | Subset     | CPU/RAM/wall-clock on equal fixtures, live deployment, process recovery           |

## Kitesurf references and scope

[The official engine overview](https://developers.cloudflare.com/browser-run/kitesurf/)
and [the September update](https://blog.cloudflare.com/kitesurf-update/) cover the
engine, CDP clients and newer module/layout/WebMCP support. Browser Run also has
[quick actions](https://developers.cloudflare.com/browser-run/quick-actions/):
content, screenshot, PDF, markdown, snapshot, accessibility tree, scrape, JSON,
links and crawl. Service features and engine features need separate tests.

The [launch article](https://blog.cloudflare.com/kitesurf/) identifies video,
WebGL, challenge-sensitive networking and long-lived authenticated browser state
as unsuitable workloads. These remain targets for Nimbo. Their feasibility
inside a Worker is not established by the existence of a provisioning tool.

The [WPT dashboard](https://kitesurf.dev/wpt) measures a selected corpus and
changes over time. Track its pinned suite revision, files and subtests; a high
aggregate percentage does not establish every API or full web compatibility.
Use the same fixture, output, cache conditions and runtime when comparing
[published performance measurements](https://kitesurf.dev/benchmarks).

## Obscura references and scope

Audit the [public upstream](https://github.com/h4ckf0r0day/obscura) at revision
`0cdd42e63bee6c5c7702039a675579cbfd545f5d`. The
[CDP and MCP inventory](obscura-contract-inventory.json) records candidate method names and
source links. It does not classify upstream acknowledgements as implemented
behavior. Tests must include corresponding asynchronous events and failures.

The [architecture](https://github.com/h4ckf0r0day/obscura/blob/0cdd42e63bee6c5c7702039a675579cbfd545f5d/docs/Architecture-overview.md)
includes rendering, page/runtime isolation, transport, lifecycle and storage.
Its classic workers share a runtime; this is not evidence of separate worker
isolates. Render builds and DOM-only builds need distinct baseline results.

The [MCP contract](https://github.com/h4ckf0r0day/obscura/blob/0cdd42e63bee6c5c7702039a675579cbfd545f5d/docs/Use-the-MCP-server.md)
covers navigation/history, snapshots/markdown/extraction, element reads,
form/input actions, waits/evaluation, diagnostics, captures, storage and tabs.
The [CLI contract](https://github.com/h4ckf0r0day/obscura/blob/0cdd42e63bee6c5c7702039a675579cbfd545f5d/docs/CLI-reference.md)
adds fetch/serve/scrape/MCP modes, output formats and batching. Those contracts
must work through the actual engine, not only an adapter returning success.

At the audited revision, the public
[browser API implementation](https://github.com/h4ckf0r0day/obscura/blob/0cdd42e63bee6c5c7702039a675579cbfd545f5d/crates/obscura-js/js/bootstrap.js)
returns `null` for WebGL contexts and rejects media playback without a decoder.
WebGL/media classes alone do not mean those workloads are supported. Nimbo's
target includes actual graphics and decoding beyond these upstream gaps.

The upstream dispatcher also accepts several domains with empty acknowledgements
(including CSS, Debugger and Profiler). Treat these as compatibility responses,
not evidence of implemented domain behavior. Nimbo's acceptance requires the
requested effects and resulting state, even where the upstream baseline omits
them.

## Worker feasibility gates

1. Implement DOM, scheduling, modules, transport and protocols in the shared
   engine; require native and Wasm checks for each added behavior.
2. Use durable state for sessions. Test recovery before promising long-lived
   JavaScript state: persisted cookies are not a persisted JS heap.
3. Prototype layout, rasterization, fonts and codecs within Wasm budgets.
   Screenshots must use the same geometry as interaction and DOM measurements.
4. Evaluate custom TLS over raw sockets separately from platform-managed TLS.
   The [socket API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
   exposes transport controls; it does not itself prove selectable browser
   ClientHello fingerprints.
5. Use [Alchemy resources](https://alchemy.run/cloudflare/compute/workers/) for
   provisioning. If a capability needs another runtime, document the failed
   Worker experiment and the actual alternative's tests before claiming support.
