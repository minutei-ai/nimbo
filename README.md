# Nimbo

A headless browser engine for scraping JavaScript-driven pages and SPAs. It loads a page, runs its JavaScript and extracts data from the resulting DOM.

Rust owns the browser implementation; QuickJS executes page JavaScript. Browser bindings are compiled to version-matched bytecode during the build; each page creates fresh runtime and DOM state. The same engine runs as WebAssembly in Workers and celld, or through the native CLI.

Nimbo's target is to provide Obscura's browser capabilities inside Cloudflare Workers through its own engine. Obscura is an optional, separate test comparator; it is never a runtime backend, dependency or fallback.

Native independent XML document roots now support document-owned element,
attribute, text and fragment factories and real cross-document insertion.
The original Attr/NamedNodeMap WPT cohort passes 53/53; the attribute namespace
cohort passes 88/101. XML parsing, frames and complete DOM conformance remain
pending. See the [document coverage](docs/browser-coverage.md#native-independent-xml-documents)
for validated behavior and remaining gaps.

The target includes Kitesurf's public browser contracts and the capabilities it
explicitly excludes. JavaScript and SPA scraping, with optional proxies, remain
the core workflow. Browser features serve that workflow; unrelated product
layers are outside the scope. Workers is the primary runtime, and any additional
runtime must address a measured capability gap. This is the implementation
target; the coverage inventory records what actually works today.

[Cloudflare guide](docs/cloudflare.md) · [celld guide](docs/celld.md) · [Browser coverage](docs/browser-coverage.md) · [Quality policy](docs/rust-quality.md)

## Getting started

Requirements: Bun, Rust, `clang`, `llvm-ar` and `wasm-ld`. The Rust toolchain configuration includes the Wasm target.

```sh
bun install --frozen-lockfile
cargo install wasm-bindgen-cli --version 0.2.129 --locked
bun run build:worker
bun run browser https://example.com 'document.querySelector("h1").textContent'
```

```sh
bun run check         # formatting, build, lint, tests, Rust docs and release tests
bun run test:worker   # real workerd execution, including local HTTP fixtures
bun run test:browser  # native HTTP adapter tests
```

The build produces `dist/worker/index.js` and `dist/worker/nimbo_engine_bg.wasm`. Generated artifacts are ignored by Git. Bun and Cargo workspaces use pinned dependencies and committed lockfiles.

## Architecture

```mermaid
flowchart LR
    Client[Collector] --> Worker[TypeScript + Effect Worker]
    Worker --> Engine[Rust Wasm: DOM + QuickJS]
    Engine --> Actions[HTTP actions / JSON result]
    Actions --> Worker
    Worker --> Transport[fetch / proxy sockets / EGRESS binding]
    Transport --> Source[HTTP origin]
```

The Rust engine produces HTTP actions and consumes responses. The host supplies transport and a monotonic clock. Page JavaScript runs in QuickJS, separate from host bindings and credentials. Cloudflare Workers and celld use the same prebuilt Worker/Wasm bundle; the native CLI uses a native HTTP adapter.

| Directory              | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `crates/engine/`       | Rust DOM, QuickJS execution, CSS, layout, canvas and native CLI |
| `apps/worker/`         | Worker API, authentication and transport                        |
| `apps/infrastructure/` | Alchemy Cloudflare stack                                        |
| `tooling/`             | Builds, real HTTP fixtures, tests and benchmarks                |
| `docs/`                | Coverage, evidence and runtime guides                           |

## HTTP API

`GET /health` returns the engine identity and version. `POST /scrape` requires the `API_TOKEN` binding and a bearer token. Keep the endpoint and token in private environment variables:

```sh
curl "$NIMBO_URL/scrape" \
  -H "Authorization: Bearer $NIMBO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com","expression":"document.title"}'
```

Successful responses contain `url`, `value` and `engine: "rust-wasm-quickjs"`. Failures return an HTTP status and an `error` field. Scraping is unavailable without an API token.

| Field                | Behavior                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `url`                | HTTP destination                                                                          |
| `expression`         | JavaScript extraction expression                                                          |
| `scripts`            | `execute` by default; `skip` parses received HTML without loading or running page scripts |
| `maxStylesheetBytes` | CSS budget: 1 byte–2 MiB; default 256 KiB                                                 |
| `maxLayoutNodes`     | Visits per CSS collection/layout pass: 1–4096; default 1024                               |
| `maxDomOperations`   | Shared DOM/CSS work budget: 1–1,000,000 operations; default 10,000                        |

The extraction expression still runs in `skip` mode. That mode does not hydrate JavaScript applications. Other request, DOM and execution limits still apply.

The optional `PROXY_URL` secret selects Nimbo's native Worker socket transport. Alternatively, `EGRESS` implements `fetch(Request): Promise<Response>`; the bindings are mutually exclusive. Without either binding, the Worker uses its own `fetch`. Proxy credentials and destination policies belong in private configuration. HTTP/CONNECT support does not establish controllable TLS fingerprints.

## Scraping scope

The core workflow is navigation, page JavaScript, asynchronous network activity,
DOM updates and extraction. Proxy configuration belongs to the transport. The
Worker accepts a private `PROXY_URL` secret for HTTP proxies, HTTPS proxies to
HTTP destinations, and SOCKS5 with remote DNS (`socks5h`). Nimbo implements the
protocols over Worker sockets. HTTPS destinations through HTTP/SOCKS5h proxies
use a native TLS upgrade. Nested TLS through HTTPS proxies and local SOCKS DNS
remain missing in Workers; production TLS behavior remains unverified. The
native CLI and Rust library support HTTP/HTTPS proxies and both SOCKS5 DNS
modes. See the [Worker transport guide](docs/cloudflare.md#transport-and-limits)
and [real socket evidence](docs/browser-coverage.md#worker-proxy-transport).
Proxy addresses and credentials stay in private configuration.

For the native CLI, load `NIMBO_PROXY_URL` from your private environment, then run:

```sh
bun run browser https://example.com 'document.title'
```

An explicit `--proxy <URL>` before the destination overrides `NIMBO_PROXY_URL`.
Supported schemes are `http`, `https`, `socks5` (local DNS) and `socks5h` (proxy
DNS). URL credentials configure proxy authentication. Navigation, redirects,
stylesheets, scripts, modules and page fetch share that transport. A failed proxy
returns an error; it never falls back to a direct connection. TLS certificate
verification remains enabled. Ambient system proxy variables are ignored.
See the [real proxy validation](docs/browser-coverage.md#native-proxy-transport).

[Obscura](https://github.com/h4ckf0r0day/obscura) runs JavaScript in V8 and provides scraping commands,
HTTP/SOCKS proxies and CDP automation, with optional rendering builds. [Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/)
provides an ephemeral Worker browser for agent tasks and content extraction.
Its [engine uses V8 isolates and Rust/Wasm](https://blog.cloudflare.com/kitesurf/);
video, WebGL, TLS fingerprint control and long-lived authenticated sessions
remain outside its documented scope.
These are references for Nimbo's browser contracts and efficiency. Current
compatibility and performance are measured below and in the coverage inventory.

## Browser capabilities

The engine implements bounded browser subsets. See the [coverage inventory](docs/browser-coverage.md) for individual contracts, real Chromium comparisons, known divergences and pending work.

| Surface                          | Current scope                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML and DOM                     | Parsing, selectors, attributes, text, mutations and selected element interfaces                                                                                         |
| JavaScript                       | Classic scripts, supported modules, live bindings, top-level await, Promises, bounded timers and animation callbacks                                                    |
| HTTP                             | Redirects, shared HTTP/document cookies, page fetch and per-page isolation; simplified browser networking                                                               |
| URL                              | Native parsing and form encoding, live URLSearchParams and bounded Web IDL bindings; original WPT failures remain                                                       |
| Storage                          | Bounded local/session storage; Worker requests start fresh                                                                                                              |
| CSS                              | Native declarations, selector matching, cascade, computed-style subsets and bounded numeric CSS transitions                                                             |
| Layout                           | Native block/flex/grid geometry, explicitly inset absolute/fixed boxes, selected sticky/scroll metrics and HTML categories; incomplete text layout                      |
| CSSOM                            | Constructed sheet replacement, ordered live rules, declarations, Document adoption, document stylesheet list and HTML style/link-owned sheets; grouping/imports pending |
| SVG                              | Native outer viewport intrinsic sizing and CSSOM style; internal graphics geometry and painting remain pending                                                          |
| Canvas                           | Rust software OffscreenCanvas bitmap, selected 2D pixel operations and bounded native `TextMetrics.width`                                                               |
| Compatibility work still pending | Full HTML/CSSOM/WPT behavior, font fallback and text layout, painting, screenshots/PDF, WebGL, video, controllable TLS, durable browser sessions and CDP automation     |

Scripts run after parsing; this is a simplified lifecycle. Frames are explicitly rejected. Images are not loaded. Import maps, JSON modules, IndexedDB and full CORS/networking contracts remain incomplete. Supported CSS metadata does not imply font rendering or painting. Loaded uncompressed TrueType fonts now provide native OpenType widths for one LTR Latin run through `OffscreenCanvasRenderingContext2D.measureText`; pure block text now uses those owned font resources for native whitespace collapse and greedy line wrapping, including invalidation after text, style or font-set changes. DOM block text also has a deterministic public Liberation 2.1.5 profile: Serif, Sans and Mono with actual regular, bold, italic and bold italic faces, normal line metrics and positive/negative letter spacing. Loaded static faces and the builtin profile share the same native shaper. Generic serif/sans-serif/monospace and selected metric-compatible family aliases select this profile; system-ui selects its Sans family. Font fallback across missing glyphs, mixed inline elements, generated text boxes, bidi/script itemization, glyph bounding boxes and text painting remain pending. Canvas measurements require a loaded matching normal face and a normal canvas font with an explicit pixel size; unsupported inputs fail explicitly.

The shaper uses the public [HarfRust library](https://github.com/harfbuzz/harfrust), without an alternate browser backend. User-loaded font bytes remain private per page; the immutable public default profile is shared and parsed lazily. Loaded fonts retain the existing 1 MiB per-source, 4 MiB cumulative and 128-attempt limits. A shaping call accepts at most 1,024 UTF-8 bytes; Canvas shaping input is capped at 65,536 cumulative bytes per page, and canvas font size at 4,096 CSS pixels. DOM text sources are limited to 65,536 bytes per block, with 1,024 UTF-8 bytes per normalized run and 1 MiB cumulative shaping input per layout scene. Unsupported inputs fail before geometry is exposed.

Constructed CSSOM currently differs from Chromium for a non-configurable indexed rule-list definition. Document adoption is implemented, with two recorded cascade-order differences from Chromium. HTML style/link-owned flat rules support live mutation, and Document.styleSheets exposes a live list. Imports, association lifecycle and grouped rule wrappers remain pending. These divergences remain visible in the real fixtures and evidence.

## Resource limits

Each extraction owns its page and cookie jar. One active page per isolate is allowed; overlapping requests receive HTTP 429. Effect releases the page and permit on failures.

Defaults include a 10-second deadline, 2 MiB of accumulated HTTP responses, 32 physical requests including redirects, 10,000 DOM operations, 4 MiB of DOM writes, a 32 MiB QuickJS heap, a 64 KiB extraction expression and 10,000 microtasks. Timers and animation frames share limits of 1024 pending callbacks and 10,000 executions.

QuickJS interrupt budgets bound JavaScript work; they are not elapsed milliseconds. Native callbacks have size/operation limits. The QuickJS heap limit does not describe total isolate memory. Same-origin restrictions do not provide complete SSRF or DNS-rebinding protection; operational destination policies need separate enforcement.

## Benchmarks

Run the Worker/Wasm benchmark **inside celld**:

```sh
bun run bench:celld
```

The runner starts an owned celld process and a real HTTP fixture, runs page JavaScript (including fetch, POST, timers, DOM mutations, events and module imports), verifies extraction values, excludes three warmups and reports 21 measured samples per scenario. It cleans up its process and temporary state. `CELLD_BINARY` optionally selects the executable. See the [celld guide](docs/celld.md) and [initial three-scenario results](docs/performance-celld.json).

```sh
cargo build --release -p nimbo-engine --locked
bun run bench:browser  # native CLI; a fresh process per extraction
bun run bench:worker   # an existing Worker endpoint; requires private environment settings
bun run bench:compare  # Nimbo in celld vs public Obscura vs unmodified Chromium
bun run bench:obstacle # original upstream obstacle fixtures in Nimbo/celld
bun run bench:wpt-url  # pinned original URL WPT window variants in Nimbo/celld
bun run bench:wpt-sticky # pinned original sticky WPT fixtures; optional Obscura comparator
bun run bench:wpt-z-index # original z-index parsing and computed WPT fixtures
bun run bench:wpt-transitions # original transition parsing/computed/shorthand WPT fixtures
bun run compare:transitions # real-clock transition contracts in celld and Chromium
bun run bench:wpt-logical-spacing # original logical spacing WPT files
bun run compare:logical-spacing # real geometry and logical transitions in celld/Chromium
bun run compare:contextual-box-lengths # font/viewport lengths and real geometry
bun run compare:resolved-box-values # native used box CSSOM values and live updates
bun run bench:wpt-contextual-box-lengths # original unit WPT files
bun run compare:svg-viewport # outer SVG sizing in celld and Chromium
bun run compare:script-modes # classic/strict/module semantics in celld and Chromium
bun run compare:font-shaping # native OpenType widths with real loaded fonts
bun run compare:text-layout # native DOM text geometry versus Chromium
bun run compare:background-color # live background-color computation in celld and Chromium
bun run bench:wpt-background-color # original declaration and computed color WPT
bun run compare:layout-snapshot # geometry invalidation after DOM, CSSOM and scroll changes
bun run bench:wpt-cssom-owner # original stylesheet replacement and ownership WPT
bun run compare:document-stylesheets # live lists and link sheets vs Chromium
bun run bench:wpt-document-stylesheets # original StyleSheetList WPT
bun run compare:attribute-namespaces # native attribute namespaces vs Chromium
bun run bench:wpt-attribute-namespaces # original attribute WPT; failures retained
bun run bench:wpt-attribute-nodes # original Attr/NamedNodeMap WPT; failures retained
bun run compare:window-named # native DOM names and reflection vs Chromium
bun run bench:wpt-window-named # original named access WPT; failures retained
bun run compare:animation-frames # real-clock callback batches and cancellation
bun run bench:wpt-animation-frames # original animation callback WPT files
bun run bench:wpt-svg-viewport # original SVG API and image WPT files
```

Native Rust suites use four concurrent tests so real-clock transition assertions
are not displaced beyond their sampling window by unrelated CPU-heavy suites.
All cases and assertions still run against real HTTP and the native engine.

Native CLI timings, local celld HTTP timings and deployed Cloudflare measurements are different measurements. The remote driver requires a fixture origin reachable from the Worker; the [Cloudflare guide](docs/cloudflare.md) explains that setup. Local measurements do not establish production throughput, memory use or cost.

See the [comparison guide](docs/benchmark-comparison.md) for the three-runtime benchmark, baseline failures and optimization results. Use the [engine build comparison](docs/benchmark-engine-comparison.md) to measure two Nimbo builds through the same celld HTTP adapter.

The [upstream benchmark matrix](docs/benchmark-reference-matrix.md) records exact suite obligations, immutable public source revisions and the first 33-stage Obscura obstacle baseline. Passing the internal suite does not establish an upstream stealth or framework pass.

### Current performance

Measured on 2026-10-05 UTC (2026-10-05 in São Paulo) with Nimbo's Worker/Wasm bundle inside celld 0.6.1,
public Obscura 0.2.3 and unmodified Chromium 153. Each extraction uses a fresh
page. Hosts stay running; runtime order rotates at concurrency 1. Three warmups
are excluded from 21 measured samples per scenario. All 648 attempts returned
the expected values over real HTTP, without mocks.

Latency in milliseconds, **p50 / p95**:

| Scenario                | Nimbo / celld |        Obscura |        Chromium |
| ----------------------- | ------------: | -------------: | --------------: |
| Static HTML             | 10.13 / 19.51 |  19.32 / 20.54 |   61.41 / 75.41 |
| Selectors, 200 nodes    | 15.21 / 18.72 |  19.50 / 21.16 |   62.46 / 76.85 |
| Dynamic fetch           | 13.76 / 15.67 |  21.31 / 23.00 |   63.75 / 77.65 |
| JS, DOM and events      | 21.75 / 25.32 |  30.18 / 31.78 |   65.25 / 85.85 |
| JS modules              | 25.17 / 31.21 |  30.08 / 33.33 |   73.08 / 92.74 |
| JS selectors, 200 nodes | 24.28 / 28.73 |  31.11 / 38.62 |   67.39 / 85.71 |
| Static HTML, 5000 nodes | 36.69 / 46.39 |  42.83 / 45.33 | 260.21 / 289.75 |
| Selectors, 5000 nodes   | 47.16 / 64.61 | 97.94 / 110.47 | 251.41 / 291.12 |
| JS positioned boxes     | 42.42 / 52.09 |  32.75 / 34.75 |   68.06 / 89.88 |

Nimbo has lower p50 than Chromium in **9/9** scenarios and Obscura in **8/9**
in this run. Positioned-box p50 remains higher than Obscura (42.42 ms versus
32.75 ms), as does p95 (52.09 versus 34.75 ms). Static HTML with 5,000 nodes
also has higher p95 (46.39 versus 45.33 ms). Complete performance parity remains
pending. These local fixtures do not establish general SPA compatibility,
production throughput, memory consumption or cost. These measurements precede DOM text layout. The font-width contracts
are measured separately from these extraction scenarios. See the
[raw results](docs/performance-comparison-font-widths.json) and
[reproduction guide](docs/benchmark-comparison.md).

The [previous layout snapshot](docs/performance-comparison-layout-work.json)
is retained with its original artifact hash and results. Independent snapshots
do not establish a causal performance improvement or regression.

The loaded-font width foundation increases the uncompressed Wasm from
9,294,708 to 10,356,700 bytes. Gzip level 9 increases from 2,709,074 to
3,088,035 bytes. These are artifact sizes, not process memory or deployment
measurements. The [font-shaping evidence](docs/evidence/font-shaping-widths.json)
records both artifact hashes and the real font comparisons. DOM text layout is validated separately in the [text layout evidence](docs/evidence/text-layout.json), using the same 12 assertions in 64 real HTTP pages per runtime and a tolerance of one Chromium layout unit (1/64 CSS px). This fixture covers loaded fonts and pure block text; it does not establish full SPA or private integration compatibility.

The [public font profile evidence](docs/evidence/font-profile.json) records 14 identical assertions in 64 fresh pages per runtime using actual public Liberation 2.1.5 files. The [order geometry evidence](docs/evidence/order-layout.json) records nine assertions per page for stable flex/grid ordering, mutations, generated boxes and `display:contents`. Native HTTP and Worker checks use the same fixtures. Reproduce with `bun run compare:font-profile` or `bun run compare:order-layout`, with the Chromium and celld binaries configured as above. These are supplemental contracts, not original WPT tests; private integrations remain unverified by these fixtures.

Anonymous text in flex/grid containers now uses native shaping, whitespace collapse and real intrinsic dimensions. Fully authored flex/grid buttons are supported when font, border, padding and box sizing override the relevant UA defaults. Default controls, general mixed inline formatting, inline-grid boxes, nonbaseline vertical alignment and anonymous text through `display:contents` remain unsupported and fail explicitly. Native CSSOM validates and serializes `font-feature-settings` and `font-variation-settings`; only default settings currently participate in layout. Nondefault shaping features and variable axes remain pending.

The [anonymous text](docs/evidence/anonymous-text.json), [authored buttons](docs/evidence/authored-button.json) and [font settings](docs/evidence/font-settings.json) evidence uses 64 distinct fresh pages per runtime against ordinary Chromium and Nimbo in celld. Reproduce with `bun run compare:anonymous-text`, `bun run compare:authored-button` and `bun run compare:font-settings`. These are original supplemental fixtures, not WPT. A separate negative-index regression follows CSS Fonts 4; Chromium 153 accepts that invalid input, so it is excluded from the common comparison and recorded as a divergence. These checks do not establish private integration coverage or new performance results.

First text baselines now come from actual font metrics and participate in native flex/grid alignment, including borders, padding, nested blocks, line wrapping and normal/fractional line heights. A bounded inline formatter supports a block containing exactly one `inline-flex` box. It uses the parent's real font strut, native child baselines and shrink-to-fit sizing; it preserves the CSS inline display value and ignores flex-item properties that do not apply in that context. Fully authored buttons accept `appearance:button`, `none` and `auto` for geometry. This does not implement native control painting.

The [text baseline](docs/evidence/text-baseline.json), [atomic inline](docs/evidence/atomic-inline.json) and [rounded box](docs/evidence/rounded-box.json) evidence compares original fixtures against ordinary Chromium and Nimbo in celld. Reproduce with `bun run compare:text-baseline`, `bun run compare:atomic-inline` and `bun run compare:rounded-box`. Physical border radii and user-select declarations are accepted for rectangular box, scroll and IntersectionObserver v1 geometry. Rounded painting, computed values for these properties and selection APIs remain pending. These contracts do not establish complete inline layout, private integration coverage or new performance results.

Native IntersectionObserver v1 geometry now retains bounded `inset()` and `polygon()` clips in its layout snapshot. Coordinates resolve against the real border box, including percentages, `calc()`, font units and viewport units. Overflow follows the containing-block chain; clip paths also apply to DOM descendants outside that chain. The [clip geometry evidence](docs/evidence/clip-geometry.json) compares 64 distinct HTTP pages per runtime against Chromium and Nimbo in celld. Reproduce with `bun run compare:clip-geometry`. Other reference boxes, circles, ellipses, rounded insets, inherited clip values and SVG URL clips remain unsupported; native shape painting remains pending. These are original supplemental contracts, not original WPT tests.

Empty absolute `::before` and `::after` boxes now use native blockification and positioning. They remain distinct from their originating DOM element and contribute real scroll overflow without taking normal-flow space. The [positioned generated box evidence](docs/evidence/positioned-generated.json) compares 64 distinct HTTP pages per runtime, covering owner and ancestor containing blocks, percentage insets, borders and padding, stretching, flex/grid containers and mutations. Reproduce with `bun run compare:positioned-generated`. Non-empty generated content, generated fixed/sticky positioning and automatic static-position rectangles remain unsupported. These supplemental contracts do not establish full generated-content layout or new performance results.

The font profile embeds 4,359,164 bytes of public font data. The font evidence retains its original artifact sizes and hashes, with newer artifacts recorded in later geometry evidence; these additions have not received a new performance benchmark. Builds fetch a checksum-pinned public release into ignored build output, requiring Bun, tar and network access on the first build. The font license is included in [LICENSES/Liberation-fonts-OFL-1.1.txt](LICENSES/Liberation-fonts-OFL-1.1.txt) and copied beside the Worker bundle.

The retained [alternating Attr build comparison](docs/performance-engine-ab-attribute-nodes.json)
compares the earlier namespace and Attr builds, with 432 correct extractions
and 378 measured samples. It predates independent-document support and does
not measure this change. Independent snapshots do not establish a causal
performance improvement or regression.

## Runtime guides

- [Cloudflare Workers](docs/cloudflare.md): Alchemy configuration, secret binding, deployment and remote benchmarking.
- [celld](docs/celld.md): prebuilt Wasm execution, local development, benchmarks and deployment configuration.

The transport identifies itself as `Nimbo/0.1`. Upstream challenges fail explicitly. Nimbo currently makes no stealth or TLS fingerprint parity claim.

## Contributing

Run `bun run check` before submitting changes. New Rust crates inherit workspace lints. Keep examples synthetic and public: use `example.com` or reserved `.test` domains, and keep credentials, operational addresses, private checkout contents and infrastructure inventories out of commits and logs. Preserve credential scanning.
