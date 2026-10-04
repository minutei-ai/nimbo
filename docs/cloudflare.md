# Cloudflare Workers

Nimbo runs its Rust/QuickJS Wasm engine inside a Worker. Its Alchemy stack publishes the prebuilt JavaScript and Wasm artifacts with bundling disabled. See [Cloudflare's Wasm documentation](https://developers.cloudflare.com/workers/runtime-apis/webassembly/).

## Build and configure

Install the prerequisites in the [README](../README.md), then:

```sh
bun install --frozen-lockfile
bun run build:worker
bun run test:worker
```

Select your authenticated Alchemy Cloudflare profile through the CLI's `--profile` option. Supply `NIMBO_API_TOKEN` through your private environment. The stack reads it with `Config.Redacted` and creates the `API_TOKEN` secret binding. Keep credentials out of source and shell logs.

```sh
bun run plan:worker --profile your-profile
bun run deploy:worker --profile your-profile
```

The stack lives in `apps/infrastructure/alchemy.run.ts`. Preserve the ignored `.alchemy/` state between operations. A successful plan proves configuration, not deployment or live extraction. Local workerd tests also do not establish deployed Cloudflare behavior.

## Verify the deployed API

Set `NIMBO_URL` to the deployed endpoint privately, then:

```sh
curl "$NIMBO_URL/health"
curl "$NIMBO_URL/scrape" \
  -H "Authorization: Bearer $NIMBO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com","expression":"document.title","scripts":"skip"}'
```

The health response identifies `rust-wasm-quickjs`. An authenticated extraction must return the expected value. Check authentication failures and subsequent successful requests as well.

## Benchmark a deployed Worker

The benchmark driver uses six scenarios from `tooling/benchmark-fixture.ts`: extraction from 16 rows, 200 repeated selectors, a script fetching JSON over HTTP, and a JavaScript application using POST, timers, DOM mutations, events and module imports. Serve `benchmarkFixture` on a public test origin you control, with `/static`, `/dynamic`, `/api` and all `/app/*` routes reachable from the Worker. A localhost fixture is suitable for local celld, but cannot be reached by a deployed Cloudflare Worker.

Set these values privately:

- `NIMBO_BENCH_URL`: Worker endpoint.
- `NIMBO_BENCH_ORIGIN`: reachable synthetic fixture origin.
- `NIMBO_API_TOKEN`: authentication token.

```sh
bun run bench:worker
```

The driver checks the engine identity and every extraction result. It runs sequentially, discards three warmups per scenario and reports 21 measured HTTP round trips. Output does not include endpoint addresses or tokens. Record the runtime and placement alongside any published result; the driver does not independently identify the hosting provider.

## Transport and limits

Load `NIMBO_PROXY_URL` from your private environment before running Alchemy to
create the optional `PROXY_URL` secret binding. The native CLI reads the same
environment variable; a Worker reads its binding. Leave it unset for direct
host fetch. An alternative `EGRESS` binding supplies `fetch(Request)`; configuring
both bindings is an explicit error.

Nimbo implements HTTP forwarding, HTTP CONNECT and SOCKS5 remote DNS over
`cloudflare:sockets`, with optional Basic or SOCKS username/password
authentication. Navigation, redirects, CSS, scripts, module imports and page
fetches share cookies and request/byte/deadline budgets. Proxy failures never
fall back to direct connections. Credentials do not reach origin requests or
page JavaScript. HTTP responses support bounded content-length, chunked and
connection-close framing, with gzip/deflate decoding; Brotli and protocol
upgrades remain unsupported.

| Proxy scheme | HTTP destination  | HTTPS destination                             |
| ------------ | ----------------- | --------------------------------------------- |
| `http`       | Forwarding        | CONNECT and native TLS upgrade                |
| `https`      | TLS forwarding    | Explicit `nested proxy TLS unsupported` error |
| `socks5h`    | Remote DNS tunnel | Remote DNS tunnel and native TLS upgrade      |
| `socks5`     | Local DNS missing | Local DNS missing                             |

The [real Worker proxy suite](browser-coverage.md#worker-proxy-transport) exercises
actual workerd, real TCP/TLS forwarding and ephemeral certificates without
replacing fetch or disabling certificate verification. The pinned local runtime
logs an unsupported `expectedServerHostname` diagnostic, while rejecting a
wrong hostname and an untrusted issuer in the tests. Production Cloudflare TLS
behavior is unverified. These local results do not prove deployment compatibility
or configurable ClientHello behavior.

Cloudflare's [TCP socket API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
provides outbound connections and TLS upgrades, but blocks Cloudflare IP ranges,
localhost and private network addresses. Local fixtures explicitly allow their
isolated loopback origins; a deployed proxy must satisfy platform restrictions.

Worker platform limits apply in addition to Nimbo's own [engine limits](../README.md#resource-limits). Consult the current [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) when sizing workloads. Browser capabilities remain those of Nimbo's engine: deployment does not add WebGL, video, screenshots or durable browser sessions.
