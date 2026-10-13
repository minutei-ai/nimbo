import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import type { Readiness } from "../apps/worker/src/protocol";

type Options = typeof Readiness.Type;
const script = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/readiness.txt"),
).text();
let origin: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/readiness-data") return new Response("ready");
      return new Response(`<!doctype html><body><script>${script}</script>`, {
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
    bindings: { API_TOKEN: "test-secret" },
  });
});
afterAll(async () => {
  await worker.dispose();
  await origin.stop(true);
});

const scrape = (
  waitFor: Options,
  expression = "document.getElementById('ready').textContent",
  extra = {},
) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({ url: origin.url.href, expression, waitFor, ...extra }),
  });

test.each([
  { type: "selector", selector: "#ready" },
  { type: "predicate", expression: "readinessPhase === 2" },
  { type: "networkIdle", quietMs: 30 },
] satisfies Options["condition"][])("owned readiness over real HTTP: $type", async (condition) => {
  const response = await scrape({ condition, timeoutMs: 1000, pollIntervalMs: 5 });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: "Completed" });
});

test("network idle resets after delayed fetch completion", async () => {
  const response = await scrape(
    { condition: { type: "networkIdle", quietMs: 30 }, timeoutMs: 1000, pollIntervalMs: 5 },
    "readinessPhase === 2 && performance.now() - lastRequestComplete >= 30",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
});

test("readiness timeout reports its phase and releases Worker capacity", async () => {
  const response = await scrape({
    condition: { type: "selector", selector: ".missing" },
    timeoutMs: 25,
    pollIntervalMs: 5,
  });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "resource limit: readiness deadline" });
  expect(
    (
      await scrape({
        condition: { type: "selector", selector: "#ready" },
        timeoutMs: 1000,
        pollIntervalMs: 5,
      })
    ).status,
  ).toBe(200);
});

test.each(["Promise.resolve(true)", "1", "(() => { throw new Error('predicate failed') })()"])(
  "readiness rejects invalid predicate %s",
  async (expression) => {
    expect(
      (
        await scrape({
          condition: { type: "predicate", expression },
          timeoutMs: 100,
          pollIntervalMs: 5,
        })
      ).status,
    ).toBe(422);
  },
);

test("readiness cannot raise DOM budgets or run skipped page scripts", async () => {
  expect(
    (
      await scrape(
        {
          condition: { type: "selector", selector: ".missing" },
          timeoutMs: 1000,
          pollIntervalMs: 1,
        },
        "true",
        { maxDomOperations: 8 },
      )
    ).status,
  ).toBe(422);
  const response = await scrape(
    { condition: { type: "selector", selector: "#ready" }, timeoutMs: 25, pollIntervalMs: 5 },
    "true",
    { scripts: "skip" },
  );
  expect(await response.json()).toEqual({ error: "resource limit: readiness deadline" });
});

test("invalid polling and time budgets fail before navigation", async () => {
  for (const patch of [{ timeoutMs: 0 }, { pollIntervalMs: 0 }, { timeoutMs: 10001 }]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await scrape({
      condition: { type: "selector", selector: "#ready" },
      timeoutMs: 1000,
      pollIntervalMs: 5,
      ...patch,
    });
    expect(response.status).toBe(400);
  }
});

test("readiness predicates use the extraction expression's JavaScript mode", async () => {
  const response = await scrape(
    {
      condition: { type: "predicate", expression: "(function(){return this === globalThis})()" },
      timeoutMs: 100,
      pollIntervalMs: 5,
    },
    "true",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
});
