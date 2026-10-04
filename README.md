# Nimbo

A scraping browser engine built in Rust and QuickJS, compiled to WebAssembly and run inside a Worker. TypeScript with Effect handles authentication, HTTP transport and page cleanup. Nimbo also provides a native CLI.

Nimbo owns its browser implementation. Obscura is an optional, separate test comparator; it is never a runtime backend, dependency or fallback.

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
    Worker --> Transport[fetch / optional EGRESS binding]
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

The optional `EGRESS` binding implements `fetch(Request): Promise<Response>`. Without it, the Worker uses its own `fetch`. Proxy credentials and destination policies belong in private configuration. Generic HTTP/CONNECT support does not establish controllable TLS fingerprints.

## Browser capabilities

The engine implements bounded browser subsets. See the [coverage inventory](docs/browser-coverage.md) for individual contracts, real Chromium comparisons, known divergences and pending work.

| Surface                          | Current scope                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML and DOM                     | Parsing, selectors, attributes, text, mutations and selected element interfaces                                                                    |
| JavaScript                       | Classic scripts, supported modules, live bindings, top-level await, Promises and bounded timers                                                    |
| HTTP                             | Redirects, cookies, page fetch and per-page isolation; simplified browser networking                                                               |
| Storage                          | Bounded local/session storage; Worker requests start fresh                                                                                         |
| CSS                              | Native declarations, selector matching, cascade and computed-style subsets                                                                         |
| Layout                           | Native block/flex/grid box geometry and selected HTML categories; incomplete text layout                                                           |
| CSSOM                            | Constructed sheets, ordered live rule lists and rule declarations; document association and grouped rules pending                                  |
| Canvas                           | Rust software OffscreenCanvas bitmap and selected 2D pixel operations                                                                              |
| Compatibility work still pending | Full HTML/CSSOM/WPT behavior, text shaping, painting, screenshots/PDF, WebGL, video, controllable TLS, durable browser sessions and CDP automation |

Scripts run after parsing; this is a simplified lifecycle. Frames are explicitly rejected. Images are not loaded. Import maps, JSON modules, IndexedDB and full CORS/networking contracts remain incomplete. Supported CSS metadata does not imply font rendering or painting.

Constructed CSSOM currently differs from Chromium for a non-configurable indexed rule-list definition. Mutating document stylesheets is also pending. These divergences remain visible in the real fixtures and evidence.

## Resource limits

Each extraction owns its page and cookie jar. One active page per isolate is allowed; overlapping requests receive HTTP 429. Effect releases the page and permit on failures.

Defaults include a 10-second deadline, 2 MiB of accumulated HTTP responses, 32 physical requests including redirects, 10,000 DOM operations, 4 MiB of DOM writes, a 32 MiB QuickJS heap, a 64 KiB extraction expression and 10,000 microtasks. Timers have separate limits of 1024 pending timers and 10,000 callbacks.

QuickJS interrupt budgets bound JavaScript work; they are not elapsed milliseconds. Native callbacks have size/operation limits. The QuickJS heap limit does not describe total isolate memory. Same-origin restrictions do not provide complete SSRF or DNS-rebinding protection; operational destination policies need separate enforcement.

## Benchmarks

Run the Worker/Wasm benchmark **inside celld**:

```sh
bun run bench:celld
```

The runner starts an owned celld process and a real HTTP fixture, verifies extraction values, excludes three warmups and reports 21 measured samples per scenario. It cleans up its process and temporary state. `CELLD_BINARY` optionally selects the executable. See the [celld guide](docs/celld.md) and [recorded results](docs/performance-celld.json).

```sh
cargo build --release -p nimbo-engine --locked
bun run bench:browser  # native CLI; a fresh process per extraction
bun run bench:worker   # an existing Worker endpoint; requires private environment settings
```

Native CLI timings, local celld HTTP timings and deployed Cloudflare measurements are different measurements. The remote driver requires a fixture origin reachable from the Worker; the [Cloudflare guide](docs/cloudflare.md) explains that setup. Local measurements do not establish production throughput, memory use or cost.

## Runtime guides

- [Cloudflare Workers](docs/cloudflare.md): Alchemy configuration, secret binding, deployment and remote benchmarking.
- [celld](docs/celld.md): prebuilt Wasm execution, local development, benchmarks and deployment configuration.

The transport identifies itself as `Nimbo/0.1`. Upstream challenges fail explicitly. Nimbo currently makes no stealth or TLS fingerprint parity claim.

## Contributing

Run `bun run check` before submitting changes. New Rust crates inherit workspace lints. Keep examples synthetic and public: use `example.com` or reserved `.test` domains, and keep credentials, operational addresses, private checkout contents and infrastructure inventories out of commits and logs. Preserve credential scanning.
