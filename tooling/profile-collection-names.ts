import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Budget } from "./benchmark-protocol";
import { startWorkerd } from "./benchmark-workerd";

const baseline = process.argv[2],
  candidate = process.argv[3];
if (!baseline || !candidate || process.argv.length !== 4)
  throw new Error("Usage: profile-collection-names baseline-bundle candidate-bundle");
const builds = await Promise.all(
  [
    { label: "baseline", directory: baseline },
    { label: "candidate", directory: candidate },
  ].map(async (build) => ({
    label: build.label,
    directory: build.directory,
    wasm_sha256: createHash("sha256")
      .update(
        new Uint8Array(
          await Bun.file(resolve(build.directory, "nimbo_engine_bg.wasm")).arrayBuffer(),
        ),
      )
      .digest("hex"),
    bundle_sha256: createHash("sha256")
      .update(new Uint8Array(await Bun.file(resolve(build.directory, "index.js")).arrayBuffer()))
      .digest("hex"),
  })),
);
const Output = Schema.Struct({
  value: Schema.Literal(true),
  diagnostics: Schema.Record(Schema.String, Schema.Finite),
});
const Result = Schema.Union([
  Schema.Struct({ status: Schema.Literal(200), body: Output }),
  Schema.Struct({
    status: Schema.Literal(422),
    body: Schema.Struct({
      error: Schema.String.check(
        Schema.isStartingWith("JavaScript: Error: resource limit: DOM operations\n"),
      ),
    }),
  }),
]);
type Sample = { scenario: string; options: number } & (
  | { valid: true; diagnostics: Readonly<Record<string, number>> }
  | { valid: false; error: string }
);
const scenarios = [200, 1000].flatMap((options) => [
  {
    options,
    name: "missing",
    expression: "document.getElementById('s').selectedOptions.namedItem('missing')===null",
  },
  {
    options,
    name: "last",
    expression: `document.getElementById('s').selectedOptions.namedItem('o${options - 1}').id==='o${options - 1}'`,
  },
  {
    options,
    name: "empty",
    expression: "document.getElementById('s').selectedOptions.namedItem('')===null",
  },
]);
let budget: string | undefined;
const rounds = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const origin = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: (request) =>
              new Response(
                `<!doctype html><select multiple id=s>${Array.from({ length: new URL(request.url).pathname === "/1000" ? 1000 : 200 }, (_, index) => `<option selected id=o${index}>${index}</option>`).join("")}</select>`,
                { headers: { "content-type": "text/html" } },
              ),
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      );
      return yield* Effect.forEach(
        [0, 1, 2],
        (round) =>
          Effect.forEach(
            round % 2 === 0 ? builds : builds.toReversed(),
            (build) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const host = yield* Effect.acquireRelease(
                    Effect.promise(() => startWorkerd(build.directory)),
                    (owned) => Effect.promise(() => owned.stop()),
                  );
                  const limits = yield* Effect.promise(async (): Promise<unknown> =>
                    (await fetch(new URL("/health", host.endpoint))).json(),
                  ).pipe(
                    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ limits: Budget }))),
                  );
                  const current = JSON.stringify(limits.limits);
                  if (budget === undefined) budget = current;
                  else if (budget !== current)
                    return yield* Effect.die(new Error("Named collection profile budgets differ"));
                  const samples = yield* Effect.forEach(
                    scenarios,
                    (scenario) =>
                      Effect.promise(async (): Promise<unknown> => {
                        const response = await fetch(new URL("/scrape", host.endpoint), {
                          method: "POST",
                          headers: { authorization: `Bearer ${host.token}` },
                          body: JSON.stringify({
                            url: new URL(`/${scenario.options}`, origin.url).href,
                            expression: scenario.expression,
                            diagnostics: true,
                          }),
                        });
                        const body: unknown = await response.json();
                        return { status: response.status, body };
                      }).pipe(
                        Effect.flatMap(Schema.decodeUnknownEffect(Result)),
                        Effect.flatMap((result): Effect.Effect<Sample> => {
                          if (result.status === 422) {
                            if (build.label !== "baseline" || scenario.options !== 1000)
                              return Effect.die(
                                new Error("Unexpected named collection quota failure"),
                              );
                            return Effect.succeed({
                              scenario: scenario.name,
                              options: scenario.options,
                              valid: false,
                              error: "resource limit: DOM operations",
                            });
                          }
                          return Effect.succeed({
                            scenario: scenario.name,
                            options: scenario.options,
                            valid: true,
                            diagnostics: result.body.diagnostics,
                          });
                        }),
                      ),
                    { concurrency: 1 },
                  );
                  return {
                    round,
                    build: build.label,
                    wasm_sha256: build.wasm_sha256,
                    bundle_sha256: build.bundle_sha256,
                    host_version: host.version,
                    limits: limits.limits,
                    samples,
                  };
                }),
              ),
            { concurrency: 1 },
          ),
        { concurrency: 1 },
      );
    }),
  ),
);
process.stdout.write(
  `${JSON.stringify({ schema_version: 1, kind: "named-collection-resource-profile", options: [200, 1000], protocol: "three rounds; fresh single-isolate host per build; reverse build order in middle round; equal original limits; six fresh pages per host; baseline quota failures retained", latency_acceptance_measured: false, rounds }, null, 2)}\n`,
);
