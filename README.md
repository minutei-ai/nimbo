# Nimbo

A headless browser engine for scraping JavaScript-driven pages and SPAs. It loads a page, runs its JavaScript and extracts data from the resulting DOM.

Rust owns the browser implementation; QuickJS executes page JavaScript. Browser bindings are compiled to version-matched bytecode during the build; each page creates fresh runtime and DOM state. The same engine runs as WebAssembly in Workers and celld, or through the native CLI.

Nimbo's target is to provide Obscura's browser capabilities inside Cloudflare Workers through its own engine. Obscura is an optional, separate test comparator; it is never a runtime backend, dependency or fallback.

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
| Canvas                           | Rust software OffscreenCanvas bitmap and selected 2D pixel operations                                                                                                   |
| Compatibility work still pending | Full HTML/CSSOM/WPT behavior, text shaping, painting, screenshots/PDF, WebGL, video, controllable TLS, durable browser sessions and CDP automation                      |

Scripts run after parsing; this is a simplified lifecycle. Frames are explicitly rejected. Images are not loaded. Import maps, JSON modules, IndexedDB and full CORS/networking contracts remain incomplete. Supported CSS metadata does not imply font rendering or painting.

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
bun run compare:background-color # live background-color computation in celld and Chromium
bun run bench:wpt-background-color # original declaration and computed color WPT
bun run compare:layout-snapshot # geometry invalidation after DOM, CSSOM and scroll changes
bun run bench:wpt-cssom-owner # original stylesheet replacement and ownership WPT
bun run compare:document-stylesheets # live lists and link sheets vs Chromium
bun run bench:wpt-document-stylesheets # original StyleSheetList WPT
bun run compare:attribute-namespaces # native attribute namespaces vs Chromium
bun run bench:wpt-attribute-namespaces # original attribute WPT; failures retained
bun run compare:window-named # native DOM names and reflection vs Chromium
bun run bench:wpt-window-named # original named access WPT; failures retained
bun run compare:animation-frames # real-clock callback batches and cancellation
bun run bench:wpt-animation-frames # original animation callback WPT files
bun run bench:wpt-svg-viewport # original SVG API and image WPT files
```

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
| Static HTML             | 10.33 / 15.86 |  17.86 / 20.68 |   57.49 / 66.88 |
| Selectors, 200 nodes    | 10.27 / 19.46 |  18.99 / 21.43 |   57.91 / 68.98 |
| Dynamic fetch           | 10.27 / 12.61 |  20.54 / 22.96 |   63.61 / 70.21 |
| JS, DOM and events      | 20.89 / 25.57 |  28.86 / 29.76 |   64.72 / 85.04 |
| JS modules              | 25.29 / 29.14 |  30.27 / 31.17 |   68.25 / 91.65 |
| JS selectors, 200 nodes | 23.01 / 27.54 |  30.21 / 33.31 |   63.28 / 84.46 |
| Static HTML, 5000 nodes | 26.13 / 45.15 |  41.79 / 51.87 | 239.62 / 276.92 |
| Selectors, 5000 nodes   | 36.54 / 59.53 | 97.53 / 104.03 | 256.42 / 280.10 |
| JS positioned boxes     | 31.03 / 48.37 |  32.55 / 38.46 |   65.84 / 89.45 |

Nimbo has a lower p50 than both Chromium and Obscura in **9/9** scenarios
in this run. Positioned-box p95 remains higher than Obscura (48.37 ms versus
38.46 ms); complete performance parity remains pending. These local fixtures
do not establish general SPA compatibility,
production throughput, memory consumption or cost. See the
[raw results](docs/performance-comparison-attribute-namespaces.json) and
[reproduction guide](docs/benchmark-comparison.md).

## Runtime guides

- [Cloudflare Workers](docs/cloudflare.md): Alchemy configuration, secret binding, deployment and remote benchmarking.
- [celld](docs/celld.md): prebuilt Wasm execution, local development, benchmarks and deployment configuration.

The transport identifies itself as `Nimbo/0.1`. Upstream challenges fail explicitly. Nimbo currently makes no stealth or TLS fingerprint parity claim.

## Contributing

Run `bun run check` before submitting changes. New Rust crates inherit workspace lints. Keep examples synthetic and public: use `example.com` or reserved `.test` domains, and keep credentials, operational addresses, private checkout contents and infrastructure inventories out of commits and logs. Preserve credential scanning.
