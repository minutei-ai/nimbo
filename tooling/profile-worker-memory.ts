import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { processTreeRss } from "./benchmark-memory";
import { Budget } from "./benchmark-protocol";
import { startWorkerd } from "./benchmark-workerd";

const directory = resolve(process.argv[2] ?? "dist/worker");
const Result = Schema.Struct({
  engine: Schema.Literal("rust-wasm-quickjs"),
  value: Schema.Struct({
    bytes: Schema.Int,
    first: Schema.Int,
    last: Schema.Int,
    textLength: Schema.Literal(262144),
    leaked: Schema.Literal(false),
  }),
  diagnostics: Schema.Record(Schema.String, Schema.Finite),
});
const small =
  "({bytes:0,first:0,last:0,textLength:document.body.textContent.length,leaked:typeof kept!=='undefined'})";
const large =
  "(()=>{const leaked=typeof kept!=='undefined';globalThis.kept=new Uint8Array(16*1024*1024);kept[0]=7;kept[kept.length-1]=11;return {bytes:kept.length,first:kept[0],last:kept[kept.length-1],textLength:document.body.textContent.length,leaked}})()";
const scenarios = [
  { name: "small", expression: small, bytes: 0 },
  { name: "large", expression: large, bytes: 16 * 1024 * 1024 },
  { name: "large-repeat", expression: large, bytes: 16 * 1024 * 1024 },
  { name: "small-recovery", expression: small, bytes: 0 },
];
const html = `<!doctype html><body>${"x".repeat(262144)}</body>`;
const probe = Effect.scoped(
  Effect.gen(function* () {
    const origin = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () => new Response(html, { headers: { "content-type": "text/html" } }),
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    );
    return yield* Effect.forEach(
      [0, 1, 2],
      (round) =>
        Effect.scoped(
          Effect.gen(function* () {
            const host = yield* Effect.acquireRelease(
              Effect.promise(() => startWorkerd(directory)),
              (owned) => Effect.promise(() => owned.stop()),
            );
            const health = yield* Effect.promise(async (): Promise<unknown> => {
              const response = await fetch(new URL("/health", host.endpoint));
              return response.json();
            }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ limits: Budget }))));
            const samples = yield* Effect.forEach(
              scenarios,
              (scenario) =>
                Effect.gen(function* () {
                  const result = yield* Effect.promise(async (): Promise<unknown> => {
                    const response = await fetch(new URL("/scrape", host.endpoint), {
                      method: "POST",
                      headers: { authorization: `Bearer ${host.token}` },
                      body: JSON.stringify({
                        url: origin.url.href,
                        expression: scenario.expression,
                        diagnostics: true,
                      }),
                    });
                    if (response.status !== 200)
                      throw new Error("Memory profile extraction failed");
                    return response.json();
                  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Result)));
                  const before = result.diagnostics.wasmLinearBytesBefore;
                  const capacity = result.diagnostics.wasmLinearBytes;
                  if (
                    before === undefined ||
                    capacity === undefined ||
                    before <= 0 ||
                    before > capacity ||
                    before % 65536 !== 0 ||
                    capacity % 65536 !== 0 ||
                    result.value.bytes !== scenario.bytes ||
                    result.value.first !== (scenario.bytes === 0 ? 0 : 7) ||
                    result.value.last !== (scenario.bytes === 0 ? 0 : 11)
                  )
                    return yield* Effect.die(new Error("Memory profile correctness failed"));
                  return {
                    scenario: scenario.name,
                    diagnostics: result.diagnostics,
                    host_rss_after_request_kib: yield* Effect.promise(() =>
                      processTreeRss(host.pid),
                    ),
                    valid: true,
                  };
                }),
              { concurrency: 1 },
            );
            return {
              round,
              host_version: host.version,
              limits: health.limits,
              samples,
            };
          }),
        ),
      { concurrency: 1 },
    );
  }),
);
const wasm = await Bun.file(resolve(directory, "nimbo_engine_bg.wasm")).arrayBuffer();
const bundle = await Bun.file(resolve(directory, "index.js")).arrayBuffer();
const rounds = await Effect.runPromise(probe);
process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: 1,
      protocol: "three fresh single-isolate hosts; four sequential default-budget extractions",
      measurement: "post-extraction QuickJS snapshot, retained Wasm capacity and sampled host RSS",
      transient_peaks_measured: false,
      navigation_bytes: new TextEncoder().encode(html).byteLength,
      wasm_sha256: createHash("sha256").update(new Uint8Array(wasm)).digest("hex"),
      bundle_sha256: createHash("sha256").update(new Uint8Array(bundle)).digest("hex"),
      environment: {
        bun: Bun.version,
        platform: platform(),
        arch: arch(),
        release: release(),
        cpu: cpus()[0]?.model,
      },
      rounds,
    },
    null,
    2,
  )}\n`,
);
