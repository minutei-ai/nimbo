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

Implemented groundwork: [corpus v1](docs/performance-corpus.md) provides 12
shared workloads, three-round A/B reporting, artifact/corpus hashes, native peak
RSS, Worker retained host RSS and predeclared regression tolerances. Correctness
runs in the normal Worker suite at default limits. Controlled-runner regression
automation, profiling and Worker peak allocation evidence remain open.

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
Module/task expansion, cancellation and broader phase diagnostics remain open.

## 0.5 — CSS and geometry

- Expand grid placement/repetition, intrinsic sizing, nested flex/grid and positioned layout from observed extraction gaps.
- Improve percentage resolution, overflow/scroll geometry, containment and computed style invalidation.
- Add RTL and writing-mode support in a defined geometry subset.
- Publish the supported CSS subset and its numerical tolerances; reconcile older coverage notes with current implementations.

Exit: the declared geometry subset passes independent Chromium comparisons under documented tolerances. Mutation tests catch stale caches; overlarge and unsupported layout work remains bounded.

## 0.6 — Text and fonts

- Add script-aware shaping, bidi ordering and font fallback for a declared language/script matrix.
- Extend wrapping, whitespace, inline fragmentation, baselines and range geometry.
- Test missing/late fonts, mixed scripts and font changes without unbounded re-layout.

Exit: deterministic font fixtures validate shaping and geometry against independent references. Reports distinguish font-dependent differences from engine errors and record supported scripts.

## 0.7 — Transport and security boundaries

- Expand HTTP decoding, redirects, cookie rules, page fetch and generic HTTP/CONNECT proxy coverage.
- Enforce destination policy consistently across navigation, redirects and subresources; keep configuration external.
- Harden resource size/time limits, TLS failure handling and separation of API/proxy credentials from page requests.
- Add malformed-input fuzzing and isolation regressions for host bindings, prototypes, storage and failure cleanup.

Exit: transport tests cover authenticated proxies, redirects, cancellation and blocked destinations. No credential or cross-page state leakage occurs in the declared isolation model; fuzzing findings are resolved or explicitly triaged.

## 0.8 — Sessions and bounded execution at scale

- Define an explicit session API for native and Worker hosts, building on native cookie/storage state.
- Specify navigation, expiry, disposal and tenant isolation before adding persistent Worker sessions.
- Measure admission control, backpressure and bounded parallel execution at the host level.
- Add opt-in phase timings and resource counters without recording page contents or credentials.

Exit: overlapping requests, session expiry and cancellation have documented semantics and isolation tests. Sustained load reports show throughput, p95, failures and memory on each supported host; local benchmarks alone do not establish production capacity.

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

Full browser conformance, general frame support, painting, screenshots/PDF, WebGL and media playback are outside the required 1.0 scope. Promote any of these only with a concrete extraction need, a bounded design and independent validation. Chromium and Obscura remain test comparators.
