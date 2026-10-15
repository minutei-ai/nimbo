# Nimbo 0.1

A browser engine for extracting data from JavaScript pages. Rust implements the DOM, CSS, layout and networking; QuickJS executes page scripts. The same engine runs natively and as WebAssembly in Cloudflare Workers and celld.

See the [roadmap to 1.0](roadmap.md) for planned milestones and release criteria.

## Run

Requires Bun 1.4.2 and Rust 1.96.

```sh
bun install --frozen-lockfile
bun run browser:release https://example.com 'document.title'
```

Build the Worker with `bun run build:worker`. The build also requires the `wasm32-unknown-unknown` target, clang, llvm-ar and wasm-bindgen-cli 0.2.129. See [Worker setup](docs/cloudflare.md).

## API

`POST /scrape` requires the `API_TOKEN` binding. Keep endpoint and credentials in private environment variables:

```sh
curl "$NIMBO_URL/scrape" \
  -H "Authorization: Bearer $NIMBO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com","expression":"document.title"}'
```

The response contains `url`, `value` and `engine: "rust-wasm-quickjs"`. Errors return an HTTP status and `error`. `GET /health` reports engine health.

Page scripts execute by default. `"scripts":"skip"` parses received HTML and runs only the extraction expression. `maxStylesheetBytes`, `maxLayoutNodes` and `maxDomOperations` configure bounded CSS/DOM work. `timeoutMs` (up to 60 s), `maxResponseBytes` (up to 4 MiB) and `headers` (for example `user-agent` or `accept-language`, sent with every page request) are per-scrape inputs.

Page `fetch` is same-origin and sends the page's cookies. It accepts `method` (GET or POST), `body`, `headers`, `credentials` (`same-origin` or `include`) and `redirect` (`follow` or `error`). Forbidden request headers such as `cookie`, `host` and `sec-*` are dropped, as in browsers. Responses expose `Headers`, without `set-cookie`.

Optional `waitFor` waits for a selector, synchronous boolean predicate or quiet
network interval before extraction. See [readiness options](docs/readiness.md)
for Worker JSON, native usage and shared timeout/resource semantics.

## Scope

- Navigation, redirects, cookies, page fetch and isolated page state.
- Classic scripts, supported modules, Promises, timers and animation callbacks.
- DOM queries, mutations, events, storage and selected browser interfaces.
- Bounded imperative [Shadow DOM extraction](docs/shadow-dom.md), named slots and composed events.
- CSS cascade, computed styles, block/flex/grid geometry, translations and bounded text layout.
- Software OffscreenCanvas operations and native font metrics.

[Coverage](docs/browser-coverage.md) records supported contracts and divergences. Full CSS/DOM conformance, frames, painting, screenshots/PDF, WebGL, video and persistent browser sessions remain incomplete. Unsupported operations fail explicitly.

## Transport and isolation

The CLI reads an optional `NIMBO_PROXY_URL`; the Worker accepts `PROXY_URL` or an `EGRESS` fetch binding. Proxy configuration stays private. Supported protocols and platform limits are in the [transport guide](docs/cloudflare.md#transport-and-limits).

Worker extractions start with fresh runtime, DOM, cookies and storage. Native `Browser` instances retain their own cookie/storage session across navigations. The Worker permits one active page per isolate and returns 429 for overlap. Default budgets include a 10-second deadline, 32 requests, 2 MiB of responses, 10,000 DOM operations and a 32 MiB QuickJS heap. The heap limit is not total process memory.

Navigator uses the same `Nimbo/0.1` identity as HTTP. Stealth tests cover exposed automation artifacts, hidden host bindings, [Navigator contracts](https://html.spec.whatwg.org/multipage/system-state.html), object brands, receiver checks, header consistency and disposal of poisoned page state. These checks do not establish anti-bot challenge or TLS fingerprint parity.

## Performance

Local celld A/B results, same HTTP adapter and limits, fresh pages, concurrency 1, three warmups and 15 measured runs per build:

| Synthetic workload                    | Before p50 |  0.1 p50 |
| ------------------------------------- | ---------: | -------: |
| Window names after style changes      |   58.73 ms | 34.81 ms |
| Repeated class assignment with layout |   95.70 ms | 25.93 ms |
| Selector-heavy layout                 |   55.43 ms | 48.74 ms |

[Measurements](docs/performance-v01.json) include samples, p95, bundle hashes and Linux process-tree RSS after requests. RSS did not improve consistently; it includes the local host and is not page heap or peak allocation. The [broader extraction matrix](docs/performance-v01-general.json) has mixed timings; gains are specific to these workloads. Local results do not establish production throughput.

## Test

```sh
bun run check         # formatting, build, lint, tests, docs, release tests
bun run test:stealth  # real HTTP through Worker/Wasm
bun run bench:hot-paths
```

Set `NIMBO_BENCH_BASELINE_BUNDLE` to a saved Worker bundle for A/B timing. Set `NIMBO_COMPARE_CHROMIUM_BINARY` to ordinary Chromium for `bun run compare:stealth` and other `compare:*` commands. Obscura is an optional test comparator; Nimbo implements its own browser capabilities.

The [versioned extraction corpus](docs/performance-corpus.md) adds identical
native/Worker workloads, repeated A/B rounds, memory samples and explicit
regression tolerances. Run `bench:corpus:native` or `bench:corpus:worker` after
building their artifacts.
