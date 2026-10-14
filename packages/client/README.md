# @nimbo/client

Effect client for the Nimbo engine Worker. Inside Cloudflare it calls the
engine through a service binding to the Worker's `Engine` RPC entrypoint, with
no public URL or API token. Elsewhere it uses HTTP.

```ts
import { Effect } from "effect";
import { NimboError, layerBinding, scrape } from "@nimbo/client";

export default {
  async fetch(request: Request, env: { NIMBO: Parameters<typeof layerBinding>[0] }) {
    const program = scrape({
      url: "https://example.com/",
      expression: "document.title",
      waitFor: {
        condition: { type: "selector", selector: "h1" },
        timeoutMs: 3000,
        pollIntervalMs: 50,
      },
    }).pipe(
      Effect.map((result) => Response.json(result.value)),
      Effect.catchTag("NimboError", (error: NimboError) =>
        Effect.succeed(Response.json({ error: error.reason }, { status: error.status })),
      ),
      Effect.provide(layerBinding(env.NIMBO)),
    );
    return Effect.runPromise(program);
  },
};
```

- `layerBinding(env.NIMBO)` uses a service binding to the `Engine` entrypoint.
  Admission, limits and failures match `POST /scrape`.
- `layerHttp({ url, token })` calls `POST /scrape` with the engine's
  `API_TOKEN`. Interrupting the effect aborts the request, and the engine
  releases the page.
- Input is validated locally with the engine's own schema before any call.
- Failures are `NimboError` values with the engine's status (400, 422, 429,
  499, 502, 504) and a fixed reason that contains no page data. 503 means the
  engine was unreachable or answered outside the protocol.

## Alchemy

`@nimbo/alchemy` (a separate package that follows Alchemy's Effect version) deploys the engine and binds it into a caller Worker.
Load secrets with `Config.Redacted`, never from source:

```ts
import * as Cloudflare from "alchemy/Cloudflare";
import { Engine, binding } from "@nimbo/alchemy";
import { Config, Effect, Option } from "effect";

export const stack = Effect.gen(function* () {
  const proxy = yield* Config.option(Config.Redacted("NIMBO_PROXY_URL"));
  const engine = yield* Engine("Engine", {
    main: "path/to/dist/worker/index.js",
    ...(Option.isSome(proxy) ? { proxyUrl: proxy.value } : {}),
  });
  return yield* Cloudflare.Worker("Caller", {
    main: "./src/caller.ts",
    env: { NIMBO: binding(engine) },
  });
});
```

Without `apiToken`, the engine only answers service bindings; `POST /scrape`
returns 503. `proxyUrl` sends page egress through a generic HTTP/CONNECT
proxy.

`tooling/client.test.ts` covers the SDK with fake bindings and a real
Miniflare service binding between a caller Worker and the built engine.
