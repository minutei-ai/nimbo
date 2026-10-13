import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { frameworkFixture } from "./framework-fixture";
let server: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) =>
      frameworkFixture(new URL(r.url).pathname) ?? new Response("Not found", { status: 404 }),
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
  await server.stop(true);
});
const cases = (["preact", "vue", "dom-primitives"] as const).flatMap((framework) =>
  Array.from(
    { length: 64 },
    (_, variant) => [framework, variant, framework === "dom-primitives" ? 24 : 20] as const,
  ),
);
test.each(cases)("%s HTTP extraction, variant %i", async (framework, variant, expected) => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({
      url: new URL(`/frameworks/${framework}/${variant}`, server.url).href,
      expression: "comparison",
    }),
  });
  const body: unknown = await response.json();
  expect(response.status).toBe(200);
  if (typeof body !== "object" || body === null) throw new Error("Missing response");
  const value: unknown = Reflect.get(body, "value");
  if (typeof value !== "object" || value === null) throw new Error("Missing checks");
  expect(Object.keys(value)).toHaveLength(expected);
  expect(Object.entries(value).filter(([, result]) => result !== true)).toEqual([]);
});
