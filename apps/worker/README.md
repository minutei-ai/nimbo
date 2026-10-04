# Nimbo Worker

A TypeScript Worker using Effect v4 to run Nimbo's own Rust/QuickJS engine in WebAssembly.

- `GET /health`: engine identity and version.
- `POST /scrape`: extraction authenticated by the `API_TOKEN` secret binding.
- Optional `EGRESS`: HTTP transport binding; otherwise the host's `fetch` is used.
- Optional `scripts: "skip"`: extract from received HTML without running page scripts. The default is `execute`.

From the repository root:

```sh
bun run build:worker
bun run test:worker
```

Build output is a prebuilt JavaScript entry point and Wasm module. Both Cloudflare Workers and celld use that bundle. Formatting, linting and checks run from the root; source files use this package's `tsconfig.json`.

See the [root README](../../README.md) for API fields, resource limits and browser coverage, the [Cloudflare guide](../../docs/cloudflare.md) for Alchemy deployment, and the [celld guide](../../docs/celld.md) for local execution and benchmarks. Production transport and deployment require independent validation.
