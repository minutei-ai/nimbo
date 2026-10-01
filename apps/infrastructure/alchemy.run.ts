import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect } from "effect";
import { join } from "node:path";

export default Alchemy.Stack(
  "Nimbo",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const token = yield* Config.Redacted("NIMBO_API_TOKEN");
    const worker = yield* Cloudflare.Worker("Engine", {
      main: join(import.meta.dir, "../../dist/worker/index.js"),
      bundle: false,
      compatibility: { date: "2026-07-30" },
      env: { API_TOKEN: token },
    });
    return { url: worker.url };
  }),
);
