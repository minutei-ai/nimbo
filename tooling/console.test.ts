import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { Effect, Exit, Option, Schema } from "effect";
import { Nimbo, layerHttp } from "@nimbo/client";
import { Failure, Success } from "@nimbo/client/schema";

const fixture = await Bun.file(
  new URL("../crates/engine/tests/fixtures/console.txt", import.meta.url),
).text();
let origin: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const script =
        new URL(request.url).pathname === "/error"
          ? "console.warn('before failure');throw new Error('fixture failure')"
          : `globalThis.consoleChecks=${fixture}`;
      return new Response(`<!doctype html><title>console</title><script>${script}</script>`, {
        headers: { "content-type": "text/html" },
      });
    },
  });
  worker = new Miniflare({
    modules: [
      { type: "ESModule", path: join(import.meta.dir, "../dist/worker/index.js") },
      { type: "CompiledWasm", path: join(import.meta.dir, "../dist/worker/nimbo_engine_bg.wasm") },
    ],
    compatibilityDate: "2026-07-30",
    bindings: { API_TOKEN: "console-test" },
  });
});
afterAll(async () => {
  await worker.dispose();
  await origin.stop(true);
});

test("native console logging is available during page scripts", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer console-test" },
    body: JSON.stringify({ url: origin.url.href, expression: "consoleChecks" }),
  });
  const result: unknown = await response.json();
  expect(response.status).toBe(200);
  expect(result).not.toHaveProperty("console");
  expect(result).toMatchObject({
    value: {
      namespace: true,
      global: true,
      methods: true,
      empty: true,
      returns: true,
      formatters: true,
      detached: true,
      notConstructible: true,
      opaque: true,
      throwing: true,
      poisoning: true,
    },
  });
});

test("console output is explicit and retained on execution failures", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer console-test" },
    body: JSON.stringify({
      url: new URL("/error", origin.url).href,
      expression: "1",
      captureConsole: true,
    }),
  });
  expect(response.status).toBe(422);
  const result = Schema.decodeUnknownSync(Failure)(await response.json());
  expect(result.console).toEqual([{ level: "warn", text: "before failure" }]);
  expect(result.error).toContain("fixture failure");
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer console-test" },
    body: JSON.stringify({
      url: origin.url.href,
      expression: "consoleChecks",
      diagnostics: true,
      captureConsole: false,
    }),
  });
  expect(recovered.status).toBe(200);
  const fresh = Schema.decodeUnknownSync(Success)(await recovered.json());
  expect(fresh.console).toBeUndefined();
  expect(fresh.diagnostics).toBeDefined();
});

test("console count and UTF-8 byte limits retain recent messages", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer console-test" },
    body: JSON.stringify({
      url: origin.url.href,
      expression:
        "(()=>{console.clear();for(var i=0;i<120;i++)console.log('entry',i);return true})()",
      captureConsole: true,
    }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  expect(result.console).toHaveLength(100);
  expect(result.console?.at(0)).toEqual({ level: "log", text: "entry 20" });
  expect(result.console?.at(-1)).toEqual({ level: "log", text: "entry 119" });
  const bytes = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer console-test" },
    body: JSON.stringify({
      url: origin.url.href,
      expression:
        "(()=>{console.clear();for(var i=0;i<20;i++)console.log('%s','€'.repeat(2000));return true})()",
      captureConsole: true,
    }),
  });
  expect(bytes.status).toBe(200);
  const bounded = Schema.decodeUnknownSync(Success)(await bytes.json());
  expect(bounded.console).toHaveLength(16);
  expect(
    bounded.console?.every((entry) => new TextEncoder().encode(entry.text).byteLength === 4095),
  ).toBe(true);
});

test.each(["console.log(...Array(129))", "console.log('x'.repeat(65537))"])(
  "console work limits fail explicitly and release the page: %s",
  async (expression) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer console-test" },
      body: JSON.stringify({ url: origin.url.href, expression, captureConsole: true }),
    });
    expect(response.status).toBe(422);
    const result = Schema.decodeUnknownSync(Failure)(await response.json());
    expect(result.error).toContain("resource limit: console");
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer console-test" },
      body: JSON.stringify({
        url: origin.url.href,
        expression: "(()=>{console.clear();return document.title})()",
        captureConsole: true,
      }),
    });
    expect(recovered.status).toBe(200);
    expect(Schema.decodeUnknownSync(Success)(await recovered.json()).console).toEqual([]);
  },
);

test("native client preserves explicitly collected console records on errors", async () => {
  const layer = layerHttp({ url: (await worker.ready).href, token: "console-test" });
  const result = await Effect.runPromiseExit(
    Nimbo.use(
      (nimbo) =>
        nimbo.scrape({
          url: new URL("/error", origin.url).href,
          expression: "1",
          captureConsole: true,
        }),
      // Each test owns its complete runtime and its real HTTP client layer.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide
    ).pipe(Effect.provide(layer)),
  );
  const failure = Option.getOrUndefined(Exit.findErrorOption(result));
  expect(failure?.status).toBe(422);
  expect(failure?.console).toEqual([{ level: "warn", text: "before failure" }]);
});

test("console exports well-formed text for isolated UTF-16 surrogates", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer console-test" },
    body: JSON.stringify({
      url: origin.url.href,
      expression: "(()=>{console.clear();console.log('\\ud800','\\udc00','\\ud800\\udc00')})()",
      captureConsole: true,
    }),
  });
  expect(response.status).toBe(200);
  expect(Schema.decodeUnknownSync(Success)(await response.json()).console).toEqual([
    { level: "log", text: "\ufffd \ufffd \ud800\udc00" },
  ]);
});
