# Browser coverage and acceptance

The target is the union of Kitesurf's public contracts, Obscura's public
contracts, and the capabilities Kitesurf explicitly excludes. Prefer the
Worker/Wasm engine. Provision resources through Alchemy. A different runtime
requires a measured reason for the particular capability; Alchemy provisions
resources but does not change the Worker runtime's APIs.

Nimbo owns its browser engine. Obscura is a public contract reference and an
optional test comparator only. Do not use its binary, service or libraries as
a runtime backend or fallback. Parity must be implemented and exercised through
Nimbo's own engine.

This inventory is an implementation backlog, not a parity claim. An upstream
method name, successful protocol acknowledgement, or existing JavaScript global
does not prove that the behavior works. Undocumented behavior is unknown rather
than assumed unsupported. Full browser conformance needs pinned upstream WPT
tests as well as integration and application tests.

## Current evidence

`tooling/browser-live.test.ts` uses a real loopback HTTP origin, actual workerd,
and the compiled Rust/Wasm engine. It installs no transport replacements,
service mocks, browser API stubs, or canned engine results. Its 832 data variants
exercise external scripts, Unicode/entity decoding, selector identity,
ancestry, removal/reparenting, attribute mutation and POST response decoding.
They also exercise parsed and created text/comment nodes, native node identity,
parent/sibling traversal, class inheritance and character-data mutation.
The second set of 64 cases exercises fragment transfer, insertion/replacement,
self-insertion, moving existing siblings, empty text replacement and atomic
rejection of cycles, foreign references and invalid document/doctype structure.
The third set exercises live child-node and element collections, static selector
lists, identity, named lookup, read-only indices, reflection, iteration during
mutation, reparenting and fragment transfer. The fourth set exercises capture,
target and bubble phases, cancellation, once/passive listeners, listener mutation,
abortable listeners, exception reporting, dispatch reentry and native lifecycle
ordering. The fifth set exercises real-clock timeouts/intervals, shared
cancellation, timer arguments and string handlers, delay coercion, microtask
checkpoints, nested timers, exception reporting and timer-initiated HTTP POSTs.
The sixth set exercises native module graphs, relative imports, redirects,
reexports, cycles, live bindings, namespace identity, top-level await, cached
dynamic imports and deferred-script lifecycle. The seventh set checks explicit
syntax, resolution, origin, import-attribute, MIME, HTTP, export and evaluation
failures. The eighth set exercises native Web Storage across inline, external
and module scripts, UTF-16 including lone surrogates, coercion/receiver guards,
named properties, reflection, removal, clearing and fresh Worker request areas.
An additional case exercises actual quota exhaustion, atomic failure, independent
local/session quotas and reuse. These are repeated integration checks, not 832 independent platform
features. The ninth set checks native media queries against 64 explicit viewport
and preference configurations, including ranges, three-valued conditions,
serialization, CSS escapes, receiver guards and synthetic MediaQueryList events.
The tenth set rejects 64 invalid environment variants before any HTTP navigation.
The eleventh set repeats the same DOMTokenList fixture at 64 distinct URLs,
checking live attribute reads, ordered token mutations, identity, indices,
iteration, receiver guards and atomic invalid-token rejection. Including four
resource/deadline recovery cases, the real browser suite has 836 tests.
The twelfth set checks HTML namespace identity and reflected attributes with
64 distinct synthetic strings. It includes parsed SVG/MathML and an HTML
subtree inside SVG foreignObject.
The thirteenth set checks autonomous custom elements at 64 distinct synthetic
names: registration, parsed/detached upgrades, native node identity, observed
attributes, construction, connection/disconnection, fragments, innerHTML,
failed constructors and when-defined Promises. A separate resource case reaches
the 1024-definition and 1024-pending-Promise caps and verifies fresh-page recovery.
Event support remains a subset: timestamps, legacy initialization,
shadow trees, native input, AbortSignal timeout/any and fetch cancellation are
not covered by this implementation.

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

The event fixture separately records the pinned comparator's differing event
reset, passive behavior, abort/error reporting, receiver guards and lifecycle
trust/phase results. Nimbo must pass the standards-based expectations; these
recorded differences are not full browser parity evidence. Its phase-order
predicate returned both true and false across real executions, so the comparator
checks that field's boolean shape only. This is an unresolved baseline
instability, not a phase-order pass. Nimbo still requires the exact phase order
in every variant.

Timers run inside the page's own QuickJS context. The host supplies elapsed
monotonic time and waits for the engine's next deadline; it never executes page
callbacks. The native integration tests verify the
[nested timer minimum delay](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers),
pending-timer capacity, callback budget and navigation deadline. Defaults allow
1024 pending timers and 10000 timer callbacks. A pending evaluation Promise drives
future timer tasks; a settled extraction does not implicitly wait for all future
timers. HTTP remains serialized, and frames/idle scheduling and complete HTML
event-loop conformance are not implemented. The pinned comparator separately
records different interval completion, error reporting and argument guards.
An additional real HTTP/workerd case waits past the page deadline and then
successfully extracts another page, checking that timeout releases isolate
capacity and the Wasm page.

Module dependencies are discovered by the actual QuickJS compiler in a
disposable realm without evaluating source. HTTP responses populate the page's
source cache; the page then compiles and executes the native module records.
Failed discovery cannot leave partially resolved records in the page's module
map. Tests verify deferred execution with interactive readyState, final response
URLs for relative imports/import.meta, shared dependency execution and cached
module namespaces. Native tests also verify repeated roots execute once.
The pinned comparator returns null for the completed graph fixture; the suite
records that separately and requires a complete result from Nimbo.

Import maps and JSON modules remain missing. Dynamic import currently works for
already loaded sources; fetching new dynamic dependencies remains missing and
fails explicitly. Async script scheduling and full HTML module lifecycle/WPT
conformance remain incomplete. These tests do not prove application hydration
or production compatibility.

Web Storage values live in Rust and preserve UTF-16 code units. The default
quota is 64 KiB per area, counting keys and values as two bytes per code unit.
Writes validate the new total before mutating state and throw a native
`QuotaExceededError`; deletion and clear reclaim quota. Native `Browser`
navigations share local and session areas within its single permitted origin;
a separate Browser owns fresh areas. The Worker currently creates fresh areas
per request, so this does not provide durable sessions or cross-request storage.
The public boundary exposes neither the private native bridge nor host storage.
These behaviors follow the [Web Storage interface](https://html.spec.whatwg.org/multipage/webstorage.html#the-storage-interface).

The pinned comparator returns null for the completed Web Storage fixture. This
records a failed fixture, not proof that every upstream storage API is absent.
Nimbo's positive results and quota failures are asserted independently.

Storage remains a subset. IndexedDB, disk/durable recovery, separate tab/session
cloning, storage events to other windows and full Web IDL reflection are missing.
In particular the JavaScript Proxy cannot reproduce the legacy object's
non-configurable named-property descriptor behavior; such definitions are
rejected. Configurable data descriptors are covered. No browser-wide persistence
or complete WPT conformance is claimed.

HTML-namespace nodes now use a distinct `HTMLElement` class inheriting from
Element, with stable native node identity for both parsed and created elements.
Parsed SVG/MathML remain Element wrappers. Native `localName`, `tagName` and
`nodeName` preserve foreign element case; HTML names expose the expected
uppercase tag/node names and lowercase local names. Reflected title, lang,
accessKey, dir, inert and hidden read/write actual DOM attributes, including
known-value direction handling, nullable hidden union conversion and the
until-found keyword. Attribute writes retain the shared native write budget.

This implements part of the [HTMLElement interface](https://html.spec.whatwg.org/multipage/dom.html#htmlelement)
and the [hidden IDL contract](https://html.spec.whatwg.org/multipage/interaction.html#dom-hidden).
It does not implement rendering, inert input suppression, find-in-page revealing,
HTMLUnknownElement or specialized tag interfaces. Bare and unregistered subclass
construction throw TypeError. Exposing HTMLElement alone does not prove
application hydration.

The pinned comparator completes this synthetic fixture: string reflection,
direction, detached writes and custom-name inheritance checks pass. Its composite
identity, foreign-namespace, inert, hidden and receiver-guard checks return false.
The comparison records those results separately and keeps every Nimbo check true;
these grouped checks do not identify every individual upstream divergence.

The page's own CustomElementRegistry implements autonomous definitions,
get/getName, whenDefined and explicit upgrade. Native candidate traversal filters
HTML-namespace custom names in tree order without manufacturing wrappers for
unrelated nodes. Upgrades preserve existing native identity, execute real page
constructors and share per-element reaction queues. Attribute and structural
writes trigger saved lifecycle callbacks; fragments, reparenting, innerHTML and
reflected attributes use those same native mutations. Failed upgrades are not
retried, and callback exceptions report window errors. Synchronous createElement
checks attributes/children/parent after construction and returns a fresh failed
native fallback for invalid constructors. Pending whenDefined calls share a
Promise until registration resolves them. Names accept Unicode under the current
[custom-element name contract](https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name)
and [DOM name validation](https://dom.spec.whatwg.org/#valid-element-local-name).

This is not complete custom-element/WPT conformance. Customized built-ins,
scoped registries, shadow roots, ElementInternals, form association, adoption,
state-preserving moves, :defined matching and parser-interleaved construction
remain missing. Unsupported scoped registry construction and built-in/form
registration fail explicitly. Full Web IDL coercion/prototype reflection and
constructor edge cases remain unverified. The existing parser still completes
HTML before scripts execute. Registry/upgrade evidence does not prove that an
application's dynamic modules or hydration complete.

The pinned comparator returns null for this completed custom-element fixture.
The suite records its failed fixture separately from Nimbo's positive assertions;
that result does not establish that every upstream custom-element API is absent.

`Element.classList` returns a same-object DOMTokenList backed directly by the
native class attribute. It parses ordered unique tokens using ASCII whitespace,
keeps `value` raw until mutation, and supports add/remove/toggle/replace,
contains/item, indexed reads, iteration and assignment through classList.
No-op toggle and missing-token replacement avoid normalization. Invalid tokens
are checked before writes; writes consume the existing native DOM budget.
A native quota test verifies failed mutation preserves the attribute and checks
an exact-budget write on a fresh page. The budget includes the attribute name;
failed oversized writes exhaust that page's remaining write budget.
Detached elements retain their live list.

This is a subset of the [DOMTokenList contract](https://dom.spec.whatwg.org/#interface-domtokenlist).
Full Web IDL property/prototype conformance, lone-surrogate class attributes,
other token-list attributes and complete WPT coverage remain unverified.
The 64 HTTP repetitions exercise the same behavior, not distinct platform features.

Media queries use the engine's own parser and the existing public `cssparser`
tokenizer. Native `Browser::with_media` and optional Worker input `media` set
logical CSS-pixel width/height, `colorScheme` and `reducedMotion`. Defaults are
1024×768, light, and no reduced-motion preference. The same dimensions back
`innerWidth`/`innerHeight`. Dimensions must be integers in 1..16384. This is an
explicit logical viewport, not layout, paint or a measured hardware display.

`matchMedia` supports screen/all/print selection, lists, not/only, homogeneous
and/or conditions, width/height ranges and absolute CSS length units,
aspect-ratio, orientation, configured preferences, the engine's absent pointing
input, and enabled scripting. Unsupported features/values stay unknown under
[Media Queries three-valued evaluation](https://drafts.csswg.org/mediaqueries-5/#evaluating).
Negating an unknown feature does not invent a match. Parsing has a 64 KiB input
budget and a nesting bound. The interface covers fresh MediaQueryList identity,
read-only media/matches, legacy listeners, onchange and synthetic event fields.

The pinned comparator produces null for this completed media fixture; the suite
records that independently of Nimbo's environment-specific positive assertions.
This is a fixture failure, not proof that every upstream media API is absent.

Media support remains a subset. Host resize/emulation updates, automatic trusted
change events, relative font units, calc expressions, rendering-dependent
features and complete CSSOM View/MQ WPT conformance are missing. The tests verify
synthetic event delivery only; they do not prove resize-driven event scheduling
or responsive CSS layout. Existing CSS/layout/rendering gaps remain in scope.

The same release has two recorded divergences from the
[DOM textContent contract](https://dom.spec.whatwg.org/#dom-node-textcontent):
its document returns descendant text instead of null, and assigning comment
textContent fails to update the comment's data and serialization. The suite
requires standards-based results from Nimbo and explicitly records those two
failures for the pinned comparator; they are not parity claims.

The fragment fixture also records an upstream `HierarchyRequestError` when the
same release appends a text node to a document fragment. That comparator cannot
complete the fixture. Nimbo must complete all its operations and preserve the
tree after each invalid operation; the test asserts the upstream failure stage
separately instead of equating it with a successful Nimbo result.

The collection fixture records the same release's differing collection shape,
identity, reflection, mutation and iterator results. Nimbo must pass the
[NodeList and HTMLCollection contracts](https://dom.spec.whatwg.org/#old-style-collections)
and the tested [Web IDL property rules](https://webidl.spec.whatwg.org/#legacy-platform-objects).
This is not full Web IDL or DOM conformance. Static selector results now expose
NodeList instead of Array; use Array.from when array methods are needed.

The existing native Rust integration suite also uses a real HTTP listener.
The older `tooling/worker.test.ts` suite includes callback-based transport
fixtures. Those checks remain useful for boundary failures but do not count as
mock-free transport evidence. Neither local suite proves deployed performance,
TLS fingerprints, rendering or broad browser compatibility.

## Capability matrix

`Subset` means only the currently tested operations. `Missing` means there is no
implementation providing the listed behavior. `Unverified` means the current
evidence cannot establish it.

| Capability                                            | Nimbo      | Required acceptance evidence                                                       |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| HTML parsing, entities, selector queries              | Subset     | HTML and selector WPT cases, malformed input, namespaces                           |
| DOM mutation, identity and ancestry                   | Subset     | Live mutation results, detached nodes, tree-cycle rejection, WPT                   |
| Node/Text/Comment/Fragment, live collections          | Subset     | Live child collections and static selector lists; remaining Node APIs and full WPT |
| Event dispatch and lifecycle                          | Subset     | Capture/bubble, cancellation, once/passive, native input ordering                  |
| Classic scripts and Promise jobs                      | Subset     | Source ordering, exception propagation, resource exhaustion                        |
| Modules, import maps, JSON modules, dynamic import    | Subset     | Native graphs tested; import maps, JSON and new dynamic fetching missing           |
| Timers, animation frames and scheduling               | Subset     | Real-clock timers/cancellation tested; frames, idle and full event loop missing    |
| Custom elements autônomos                             | Subset     | Native upgrades, lifecycle and failed construction; scoped/built-in/form gaps      |
| Shadow DOM                                            | Missing    | Slots, composed paths, shadow boundaries and isolation                             |
| Frames and independent execution worlds               | Missing    | Same/cross-origin frames, navigation, world isolation                              |
| Fetch and HTTP navigation                             | Subset     | Real GET/POST, cookies, redirects, bodies; full headers/abort/streams              |
| XMLHttpRequest, forms, files and binary responses     | Missing    | Real uploads/downloads, encodings, progress and cancellation                       |
| CORS, CSP, mixed content and origin policy            | Subset     | Current same-origin restriction is not a browser policy implementation             |
| Network interception, response fulfillment, blocking  | Missing    | Actual request pause/continue/fail/fulfill and event/body correlation              |
| Cookies and per-navigation isolation                  | Subset     | Path/domain/expiry/Secure/HttpOnly/SameSite, independent contexts                  |
| Persistent sessions, cookies and storage              | Missing    | Restart/eviction recovery and tenant isolation via durable state                   |
| localStorage/sessionStorage/IndexedDB                 | Subset     | Web Storage/quota tested; IndexedDB, durable state and storage events missing      |
| URL, encoding, streams, File APIs and WebCrypto       | Missing    | Pinned WPT with actual algorithms and binary round trips                           |
| Page WebAssembly and Web Workers                      | Missing    | Guest modules, imports, worker messages, termination and isolation                 |
| Media queries and logical viewport                    | Subset     | Native queries/configuration tested; live updates and full CSSOM/MQ WPT missing    |
| CSS cascade, CSSOM, typed styles, layout and geometry | Missing    | Computed styles and shared layout driving queries and paint                        |
| Fonts, images, SVG and Canvas 2D                      | Missing    | Resource loading, shaping, raster output and pixel comparisons                     |
| Screenshots, PDF and screencasts                      | Missing    | Real paint output, pagination, frame changes and backpressure                      |
| Accessibility tree and snapshots                      | Missing    | Roles, names, hidden nodes, state changes and stable references                    |
| Mouse, keyboard, focus, selection and scrolling       | Missing    | Hit-testing, trusted host input and resulting page behavior                        |
| Browser/target/context lifecycle and CDP              | Missing    | Real client connections, objects, events and context isolation                     |
| Puppeteer/Playwright/DevTools compatibility           | Missing    | Unmodified clients navigating and interacting with fixtures                        |
| MCP navigation, reading, actions and diagnostics      | Missing    | Real MCP transports, page state and authenticated remote use                       |
| Markdown, links, structured extraction and crawling   | Subset     | Current JS extraction only; native outputs and real crawl jobs missing             |
| CLI batch scraping and library API                    | Subset     | Existing single-page CLI/library; bounded batches and cancellation                 |
| HTTP/CONNECT and SOCKS proxy support                  | Missing    | Generic authenticated proxy integration; no operational config in source           |
| TLS fingerprint and transport control                 | Unverified | Capture ClientHello/ALPN and verify scripted subrequests use the same transport    |
| WebGL and GPU-dependent pages                         | Missing    | Actual shader execution and pixels; software rendering must be labelled            |
| Audio/video playback and codecs                       | Missing    | Decode real media, advance playback and produce frames/samples                     |
| Challenge-dependent authentication                    | Unverified | Real authorized source behavior, with challenge failure explicit                   |
| Browser profiles and stealth surfaces                 | Missing    | Consistency with implemented behavior and measured transport; no fake API success  |
| SSRF protections and resource budgets                 | Subset     | Resolved-address policy, private IPv4/IPv6, limits and recovery                    |
| Metrics, concurrency, deployment and recovery         | Subset     | CPU/RAM/wall-clock on equal fixtures, live deployment, process recovery            |

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
