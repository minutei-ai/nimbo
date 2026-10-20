import { afterAll, expect, test } from "bun:test";
import { Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { fetchJsonHooksFixture } from "./fetch-json-hooks-fixture";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) =>
    (await fetchJsonHooksFixture(request)) ?? new Response("Not found", { status: 404 }),
});
const worker = new Miniflare({
  modules: [
    { type: "ESModule", path: new URL("../dist/worker/index.js", import.meta.url).pathname },
    {
      type: "CompiledWasm",
      path: new URL("../dist/worker/nimbo_engine_bg.wasm", import.meta.url).pathname,
    },
  ],
  compatibilityDate: "2026-07-30",
  bindings: { API_TOKEN: "test-secret" },
});
afterAll(async () => {
  await worker.dispose();
  await server.stop(true);
});
test.each(["baseline", "array", "object", "stringify"])(
  "native fetch preserves headers and body after page JSON hooks: %s",
  async (mode) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL(`/fetch-json-hooks/${mode}`, server.url).href,
        expression: "comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const result = Schema.decodeUnknownSync(Success)(body);
    expect(result.value).toBe("value|payload");
  },
);
test.each([
  [64, 1, "plain", 200],
  [65, 1, "plain", 422],
  [1, (16_384 - JSON.stringify([["x-0", ""]]).length) / 2, "quoted", 200],
  [1, (16_384 - JSON.stringify([["x-0", ""]]).length) / 2, "quoted-over", 422],
] as const)(
  "native fetch retains header budgets: %i headers, %i characters, %s",
  async (count, size, kind, status) => {
    const values = {
      plain: "x".repeat(size),
      quoted: '"'.repeat(size),
      "quoted-over": '"'.repeat(size) + "x",
    };
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL("/fetch-json-hooks/bounds", server.url).href,
        expression: `fetch("/fetch-json-echo",{headers:Object.fromEntries(Array.from({length:${count}},(_,i)=>["x-"+i,${JSON.stringify(values[kind])}]))}).then(response=>response.ok)`,
      }),
    });
    expect(response.status).toBe(status);
    if (status === 422) expect(await response.text()).toContain("fetch header limit");
    if (status === 200) {
      const body: unknown = await response.json();
      expect(Schema.decodeUnknownSync(Success)(body).value).toBe(true);
    }
  },
);
