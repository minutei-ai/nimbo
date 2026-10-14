import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Engine } from "@nimbo/alchemy";
import { Config, Effect, Option } from "effect";
import { join } from "node:path";

export default Alchemy.Stack(
  "Nimbo",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const token = yield* Config.Redacted("NIMBO_API_TOKEN");
    const proxy = yield* Config.option(Config.Redacted("NIMBO_PROXY_URL"));
    const worker = yield* Engine("Engine", {
      main: join(import.meta.dir, "../../dist/worker/index.js"),
      apiToken: token,
      ...(Option.isSome(proxy) ? { proxyUrl: proxy.value } : {}),
    });
    return { url: worker.url };
  }),
);
