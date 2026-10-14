import { afterAll, beforeAll, expect, test } from "bun:test";
import { Effect, Exit, Option, type Layer } from "effect";
import { Miniflare } from "miniflare";
import { join } from "node:path";
import {
  Nimbo,
  NimboError,
  layerBinding,
  layerHttp,
  scrape,
  type EngineBinding,
} from "@nimbo/client";

// Each test is an application entry point that provides its own layer.
const run = <A>(layer: Layer.Layer<Nimbo>, effect: Effect.Effect<A, NimboError, Nimbo>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

const failure = (exit: Exit.Exit<unknown, NimboError>) => {
  const error = Option.getOrUndefined(Exit.findErrorOption(exit));
  if (!(error instanceof NimboError)) throw new Error("expected NimboError");
  return error;
};

const fake = (scrapeResult: unknown, calls: unknown[] = []): EngineBinding => ({
  scrape: (input) => {
    calls.push(input);
    return Promise.resolve(scrapeResult);
  },
  health: () => Promise.resolve({ engine: "rust-wasm-quickjs", version: "0.1.0", limits: {} }),
});

test("binding success decodes the engine result", async () => {
  const body = { url: "https://example.test/", value: 3, engine: "rust-wasm-quickjs" };
  const exit = await run(
    layerBinding(fake({ status: 200, body })),
    scrape({ url: "https://example.test/", expression: "1+2" }),
  );
  expect(exit).toEqual(Exit.succeed(body));
});

test("engine failures keep status, reason and diagnostics", async () => {
  const error = failure(
    await run(
      layerBinding(
        fake({ status: 422, body: { error: "layout unsupported", diagnostics: { phase: "x" } } }),
      ),
      scrape({ url: "https://example.test/", expression: "1" }),
    ),
  );
  expect([error.status, error.reason, error.diagnostics]).toEqual([
    422,
    "layout unsupported",
    { phase: "x" },
  ]);
});

test("invalid input fails locally without calling the engine", async () => {
  const calls: unknown[] = [];
  const error = failure(
    await run(
      layerBinding(fake({ status: 200, body: {} }, calls)),
      scrape({ url: "https://example.test/", expression: "1", maxDomNodes: 0 }),
    ),
  );
  expect([error.status, calls.length]).toEqual([400, 0]);
});

test("unreachable engines and protocol mismatches map to 503", async () => {
  const thrown: EngineBinding = {
    scrape: () => Promise.reject(new Error("binding unavailable")),
    health: () => Promise.reject(new Error("binding unavailable")),
  };
  const exits = await Promise.all(
    [layerBinding(thrown), layerBinding(fake({ unexpected: true }))].map((layer) =>
      run(layer, scrape({ url: "https://example.test/", expression: "1" })),
    ),
  );
  expect(exits.map((exit) => failure(exit).status)).toEqual([503, 503]);
});

let engine: Miniflare;
let origin: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("<!doctype html><title>bound</title><p id=v>42</p>", {
        headers: { "content-type": "text/html" },
      }),
  });
  engine = new Miniflare({
    workers: [
      {
        name: "caller",
        modules: true,
        script: `export default {
          async fetch(request, env) {
            const path = new URL(request.url).pathname;
            if (path === "/health") return Response.json(await env.NIMBO.health());
            return Response.json(await env.NIMBO.scrape(await request.json()));
          },
        };`,
        compatibilityDate: "2026-07-30",
        serviceBindings: { NIMBO: { name: "engine", entrypoint: "Engine" } },
      },
      {
        name: "engine",
        modules: [
          { type: "ESModule", path: join(import.meta.dir, "../dist/worker/index.js") },
          {
            type: "CompiledWasm",
            path: join(import.meta.dir, "../dist/worker/nimbo_engine_bg.wasm"),
          },
        ],
        compatibilityDate: "2026-07-30",
        compatibilityFlags: ["enable_request_signal"],
        unsafeDirectSockets: [{}],
      },
    ],
  });
  await engine.ready;
});

afterAll(async () => {
  await engine.dispose();
  await origin.stop(true);
});

// The caller Worker forwards each call over a real service binding to `Engine`.
const bound: EngineBinding = {
  scrape: async (input) =>
    (
      await engine.dispatchFetch("http://caller/scrape", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).json(),
  health: async () => (await engine.dispatchFetch("http://caller/health")).json(),
};

test("service binding RPC extracts through the engine without an API token", async () => {
  const exit = await run(
    layerBinding(bound),
    Effect.all([
      scrape({ url: origin.url.href, expression: "document.querySelector('#v').textContent" }),
      Nimbo.use((nimbo) => nimbo.health),
    ]),
  );
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  const [result, health] = exit.value;
  expect([result.value, result.engine, health.engine]).toEqual([
    "42",
    "rust-wasm-quickjs",
    "rust-wasm-quickjs",
  ]);
});

test("service binding RPC reports engine failures as NimboError", async () => {
  const error = failure(
    await run(layerBinding(bound), scrape({ url: origin.url.href, expression: "missing.value" })),
  );
  expect(error.status).toBe(422);
});

test("HTTP layer reads health and is refused for scrapes on a binding-only engine", async () => {
  const layer = layerHttp({
    url: (await engine.unsafeGetDirectURL("engine")).href,
    token: "unused",
  });
  const health = await run(
    layer,
    Nimbo.use((nimbo) => nimbo.health),
  );
  expect(Exit.isSuccess(health)).toBe(true);
  const error = failure(await run(layer, scrape({ url: origin.url.href, expression: "1" })));
  expect(error.status).toBe(503);
});
