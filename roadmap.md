# Roadmap to Nimbo 1.0

Nimbo 1.0 targets reliable JavaScript data extraction with an owned Rust/QuickJS engine, available natively and in Workers/Wasm. Versions below describe planned work; a milestone ships when its exit criteria pass. Dates depend on evidence from supported workloads.

## 0.1 — Foundation

Current baseline: DOM queries and mutations, supported scripts/modules, asynchronous execution, HTTP/cookies, CSS cascade, bounded layout/text, software canvas and fresh Worker page state. Navigator contracts and synthetic stealth/isolation tests are covered. See [README](README.md) and [coverage](docs/browser-coverage.md) for limits.

## 0.2 — Reproducible performance

- Establish a versioned extraction corpus covering small pages, large DOMs, selector-heavy CSS, text, modules and repeated mutations.
- Measure cold starts, p50/p95 latency, throughput, Wasm size, peak memory and memory retained after repeated extractions.
- Profile parsing, JS/host calls, selector matching and layout; optimize measured bottlenecks while preserving operation accounting.
- Add benchmark comparisons to release reports and regression checks on a controlled runner.

Exit: repeated A/B runs retain correctness and original limits; reports include hardware/runtime versions, samples and noise ranges. Memory and latency regression thresholds are recorded before accepting optimizations. Worker and native results remain separate.

Implemented groundwork: [corpus v1](docs/performance-corpus.md) provides 13
shared workloads, three-round A/B reporting, artifact/corpus hashes, native peak
RSS, Worker retained host RSS and predeclared regression tolerances. Correctness
runs in the normal Worker suite at default limits. [Artifact-attested performance gates](docs/performance-gate.md) validate complete
A/B reports and provide a manual CI workflow for immutable native/Worker builds.
Controlled-runner acceptance evidence, profiling and Worker peak allocation
evidence remain open.
[Worker memory diagnostics](docs/diagnostics.md) separate fresh-page QuickJS
snapshots from retained isolate Wasm capacity, with a reproducible three-host
default-budget profile. Navigation HTML is released after parsing. These
snapshots do not close the transient peak allocation gate.
[Kernel RSS high water](docs/worker-rss-high-water.md) adds the owned workerd
process's lifetime peak, separate from post-response process-tree samples.
Allocator peaks and controlled A/B acceptance remain open.
[Selected option named lookup](docs/selected-names-memory.md) reuses the native
callback, avoids unmatched handles and resolves live state after DOMString
conversion. Three-round default-budget resource evidence retains baseline
quota failures; one observed Chromium/spec ordering difference is explicit.
[Binary response ownership](docs/worker-memory.md) avoids numeric JSON arrays
and a second Rust buffer; a local single-isolate probe records reduced Wasm
linear capacity under the same synthetic byte workload and default budgets.
[Lazy live child collections](docs/live-collection-memory.md) remove eager
wrapper allocation for counts, preserving indexed identity and mutations.
[Iteration-local reuse](docs/collection-iteration.md) avoids resolving every
identifier array at every index while observing native mutation versions.
[Bounded initial DOM parsing](docs/initial-dom-budget.md) stops dense initial
trees between native parser blocks and limits stored recovery diagnostics.
[Cumulative arena accounting](docs/dom-arena-budget.md) also bounds removed nodes,
script factories and native HTML replacement fragments while preserving identity.
[Native attribute counts](docs/attribute-count-memory.md) avoid materializing
attribute handles for `NamedNodeMap.length`, with independent comparisons and
three-round local memory evidence.
[Native attribute presence](docs/attribute-presence-memory.md) also avoids
transferring entire values for DOM presence and boolean reflection, with
independent namespace/receiver contracts and three-round Worker memory evidence.

## 0.3 — DOM and application compatibility

- Expand event propagation, form controls, mutation observers and live collection behavior where extraction workloads need them.
- Implement bounded Shadow DOM and custom-element lifecycle support, with explicit boundaries for unsupported behavior.
- Exercise representative framework hydration and client-side navigation using public, synthetic applications.
- Keep object brands, property descriptors, receiver checks and exception behavior consistent across owned interfaces.

Exit: each supported application completes hydration, a state update and extraction through real HTTP. New contracts have independent Chromium comparisons; unsupported APIs produce documented failures.

Implemented subset: [owned Shadow DOM](docs/shadow-dom.md) adds imperative
open/closed roots, isolated queries, native connection/adoption, named slots,
composed event retargeting and custom-element reactions. Its 57 synthetic
contracts passed native HTTP, Worker/Wasm and independent Chromium comparisons.
[Owned mutation observers](docs/mutation-observers.md) add records, filters,
old values, detached-subtree transients and ordered microtask delivery with
40 synthetic comparison contracts. Declarative parsing, scoped styles/flat-tree
geometry and wider forms remain open. [Framework extraction applications](docs/framework-applications.md)
exercise pinned Preact and Vue hydration, state changes, keyed updates, HTTP data
loading, same-document routing, back/forward restoration and unmounting.
[Owned History](docs/history.md) adds bounded entries and cloned state graphs,
current document URLs and trusted traversal events. Broader forms, declarative
shadow parsing, scoped geometry and the remaining application matrix stay open.
[Owned text controls](docs/text-controls.md) add input/textarea interfaces,
native dirty values, default-value separation, sanitization and bounded writes.
Default/default-on input values and type transitions reuse native attributes,
with 44 additional independent comparison contracts. Numeric/date/range/color/file
values, wider form ownership/submission,
selection and validity remain open. Native checkedness, dirty defaults,
indeterminate state and radio groups add 50 independent contracts.
[Owned synthetic activation](docs/input-activation.md) adds mouse/pointer
interfaces and bounded click/cancel delivery, with 46 event and 36 activation
contracts verified independently. Reset, label forwarding, focus/pickers, form
submission and anchor navigation still remain open.
[Live control selectors](docs/control-selectors.md) connect borrowed native
state to one query/CSS matcher, with 44 independent contracts. Complete validation passed
8,154 Bun tests and 203 native tests in each debug/release profile.
[Owned form association and reset](docs/forms.md) adds input/textarea owners
and transactional native reset of their existing values and checkedness.
[Owned reset buttons](docs/reset-buttons.md) add mouse/pointer activation and
the basic HTMLButtonElement interface with 42 independent contracts.
[Native option metadata](docs/option-metadata.md) adds text/value/label, live index
and select-derived form ownership without descendant handles or a copied DOM.
[Native select state](docs/select-state.md) adds sparse selectedness, dirty defaults,
live/indexed option collections, native batch resizing and transactional select reset.
Labels, validity, pickers, submission, complete exotic descriptors and wider forms remain open.
[Private collection kinds](docs/collection-receivers.md) reject cross-interface
native getters/items while preserving generic array-like iterators and forEach.
Eighty-six contracts pass on both Chromium and Nimbo, with original-fuel
interruption and fresh-page recovery.
[Observable collection iteration](docs/collection-properties.md) adds 38 contracts
for own lengths and inherited unsupported indices through temporary views,
while keeping iteration-local native ID reuse and default-budget operation counts.
The wider exotic property matrix remains open.

## 0.4 — Scripts and page readiness

- Extend module resolution/loading and cyclic module coverage without exposing host modules.
- Improve ordering of tasks, microtasks, timers, animation callbacks and resource completion.
- Add bounded readiness options: selector, predicate and configurable network-idle waiting.
- Make timeout, cancellation and failed resource diagnostics identify the failing phase.

Exit: delayed content, failed imports, timer loops and cancellation finish deterministically within request/time/heap budgets. Every readiness option has real HTTP success and failure tests.

Implemented subset: [readiness](docs/readiness.md) for selectors, synchronous
boolean predicates and configurable network idle runs in the shared Rust
machine on native and Worker hosts. Real HTTP tests cover delayed content,
request resets, timeouts, invalid predicates, DOM limits and failure disposal.
[Parser-time import maps](docs/import-maps.md) add bounded aliases, prefix and
scoped resolution, blocked entries and cyclic live export coverage. Multiple/dynamic
maps, unloaded dynamic imports, task expansion and broader phase diagnostics
remain open. [Worker client cancellation](docs/cancellation.md) interrupts host
HTTP/readiness/timer waits and releases page capacity on disconnect. Native
cancellation now covers HTTP headers/bodies, timers, readiness and QuickJS
execution through a shared irreversible signal. Broader phase diagnostics and
lifecycle cases remain open.
[Optional failure phases](docs/diagnostics.md) now report the Worker host
operation and last owned scheduler state, distinguishing host deadlines from
client interruption. Actual workerd listener tests verify bounded cancellation
records and fresh-page recovery. Native pages expose their scheduler state
after failure. Opt-in native navigation failures now preserve the original error,
report validation/request/response/initialization/execution stages and capture
the last scheduler state before disposal. Real HTTP tests cover failed response
validation, parser limits, script/lifecycle fuel and partial-body cancellation,
with fresh-page recovery. Finer transport/initialization phases remain open.
[Cooperative initial parsing](docs/cooperative-parsing.md) retains the owned
native parser across bounded host calls so Worker deadlines and disconnections
can release a partially constructed document. [Native selector traversal](docs/selector-traversal-budget.md) now checks
cancellation during matching walks and caps cumulative page work on both hosts.
Other long native operations and synchronous fragment parsing remain separate
hardening work.

## 0.5 — CSS and geometry

- Expand grid placement/repetition, intrinsic sizing, nested flex/grid and positioned layout from observed extraction gaps.
- Improve percentage resolution, overflow/scroll geometry, containment and computed style invalidation.
- Add RTL and writing-mode support in a defined geometry subset.
- Publish the supported CSS subset and its numerical tolerances; reconcile older coverage notes with current implementations.

Exit: the declared geometry subset passes independent Chromium comparisons under documented tolerances. Mutation tests catch stale caches; overlarge and unsupported layout work remains bounded.

Implemented: the [CSS geometry subset](docs/css-geometry.md) declares each
supported area, its fixture, numerical tolerance and Chromium evidence. Every
row passes 64 real-HTTP pages in Chrome for Testing 153 and the Worker host,
plus the native suite. Twelve previously unrecorded comparisons now have
evidence. Horizontal right-to-left boxes come from `dir` and `direction`
across block, flex, grid, absolute insets, logical box properties and computed
values. `layout-snapshot` and a `dir` mutation catch stale caches, and layout
stays under the node, depth, operation and time budgets. `text-align` places
atomic inline boxes in both directions, and `dir="auto"` uses the first strong
character. Inline fragment geometry, `justify`, vertical writing modes and
wider intrinsic sizing remain outside the subset.

## 0.6 — Text and fonts

- Add script-aware shaping, bidi ordering and font fallback for a declared language/script matrix.
- Extend wrapping, whitespace, inline fragmentation, baselines and range geometry.
- Test missing/late fonts, mixed scripts and font changes without unbounded re-layout.

Exit: deterministic font fixtures validate shaping and geometry against independent references. Reports distinguish font-dependent differences from engine errors and record supported scripts.

Implemented: the [text scripts matrix](docs/text-scripts.md) declares Latin,
Greek, Cyrillic, Hebrew and Arabic. Each script run is shaped with its own
script and direction, including Arabic joining. Layout text falls back per
character across `font-family` lists and `unicode-range` subsets. Inputs
outside the matrix, explicit bidi controls, mirrored characters in
right-to-left text and fallback with different line metrics fail explicitly.
A reproducible synthetic multi-script font backs two new 64-page Chromium
comparisons, and differences are classified as engine errors, font-dependent
behavior or layout-unit rounding. Han and other complex scripts, line
breaking without spaces, bidi positions and canvas fallback remain open.

## 0.7 — Transport and security boundaries

- Expand HTTP decoding, redirects, cookie rules, page fetch and generic HTTP/CONNECT proxy coverage.
- Enforce destination policy consistently across navigation, redirects and subresources; keep configuration external.
- Harden resource size/time limits, TLS failure handling and separation of API/proxy credentials from page requests.
- Add malformed-input fuzzing and isolation regressions for host bindings, prototypes, storage and failure cleanup.

Exit: transport tests cover authenticated proxies, redirects, cancellation and blocked destinations. No credential or cross-page state leakage occurs in the declared isolation model; fuzzing findings are resolved or explicitly triaged.

Implemented: [native proxy transport](tooling/native-proxy-fixture.py) runs
real HTTP/TLS origins behind HTTP, HTTPS and SOCKS5 proxies, with and without
authentication. Authenticated proxies cover redirects, cross-origin redirects
and page fetches blocked before the proxy, redirect loops, response limits,
TLS hostname and trust failures, no direct fallback, and cancellation of a
stalled response with recovery. Credentials never reach origins or errors;
the Worker suite shares the fixture. A 10,000-run [libFuzzer campaign](docs/fuzzing.md)
over HTML, CSS, selectors, import maps and expressions found nothing; it also
checks that each input leaves a clean fresh page, and a manual CI workflow
repeats it. Fetch reports network and policy failures as `TypeError` with the
host error as `cause`. Native transport does not request compressed bodies.

## 0.8 — Sessions and bounded execution at scale

- Define an explicit session API for native and Worker hosts, building on native cookie/storage state.
- Specify navigation, expiry, disposal and tenant isolation before adding persistent Worker sessions.
- Measure admission control, backpressure and bounded parallel execution at the host level.
- Add opt-in phase timings and resource counters without recording page contents or credentials.

Exit: overlapping requests, session expiry and cancellation have documented semantics and isolation tests. Sustained load reports show throughput, p95, failures and memory on each supported host; local benchmarks alone do not establish production capacity.

Implemented: [sessions](docs/sessions.md) define one native `Browser` as one
session. Pages on it interleave on one thread in program order. Tenants are
isolated by separate browsers, and `Browser::clear_session` or drop ends a
session, with cookie expiry applied per request. Cancellation keeps the
session usable. The Worker stays stateless per request. Real-HTTP tests cover
persistence, tenant isolation, overlap, clearing, expiry and cancellation.
`Page::timings` reports request, initialization and execution durations
without page data. [Sustained 120-second load reports](docs/load-testing.md)
record throughput, p50/p95, admission rejection, failures and memory for the
native and Worker hosts. These are local evidence, not production capacity.
Persistent Worker sessions remain out of scope.

Implemented groundwork: [bounded local load tests](docs/load-testing.md) reuse
the versioned corpus and existing native/Worker adapters, record admission
separately from failures and validate recovery. Host isolate limits and workload
mix are explicit. Persistent sessions, expiry/cancellation semantics and
sustained production-capacity evidence remain open.
[Optional diagnostics](docs/diagnostics.md) expose existing DOM/execution
counters and native QuickJS heap snapshots through the owned page API and an
explicit Worker request flag. Phase timings, transient allocation peaks,
failure snapshots and production-capacity evidence remain open.

## 0.9 — Release candidate

- Freeze the public extraction/session API, error taxonomy, defaults and supported platform matrix.
- Run the complete release suite: Worker, native debug/release, differential compatibility, transport, isolation, fuzzing and sustained load.
- Validate representative end-to-end extraction workloads independently and keep non-public evidence outside the repository.
- Publish installation instructions, migration notes, versioned coverage and release artifacts with checksums.

Exit: no unresolved critical security, isolation or supported-workload correctness failures. Release artifacts reproduce the validated results; remaining divergences and performance limits are documented.

## 1.0 — Stable extraction engine

- Stable public API with a documented compatibility and deprecation policy.
- Versioned browser capability matrix, supported runtimes and resource limits.
- Reproducible correctness, isolation and performance evidence for the declared extraction corpus.
- Release process with credential scanning, dependency review, rollback instructions and regression gates.

Exit: all 0.9 gates pass on the exact release artifacts. Supported workflows run in Nimbo's own engine without another browser as a runtime fallback.

## Boundaries through 1.0

Stealth work improves observable API consistency and isolation. It does not promise anti-bot challenge success, Chromium identity or TLS fingerprint parity.

Full browser conformance, general frame support, glyph and image painting, PDF, WebGL and media playback are outside the required 1.0 scope. A viewport screenshot of laid-out background colors is implemented and checked by a pixel test; it does not paint glyphs, replaced images, borders or shadows. Promote the remaining items only with a concrete extraction need, a bounded design and independent validation. Chromium and Obscura remain test comparators.
