import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { historyFixture } from "./history-fixture";
let server: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) =>
      historyFixture(new URL(r.url).pathname, r.headers) ??
      new Response("Not found", { status: 404 }),
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
test.each(Array.from({ length: 64 }, (_, i) => i))(
  "owned History over HTTP, variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({
        url: new URL(`/history/${variant}`, server.url).href,
        expression: "comparison",
      }),
    });
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(35);
    expect(Object.entries(value).filter(([, result]) => result !== true)).toEqual([]);
  },
);

const probe = (expression: string, maxDomOperations = 100000) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({
      url: new URL("/history/0", server.url).href,
      scripts: "skip",
      expression,
      maxDomOperations,
    }),
  });
test.each([
  [
    "entries",
    "(()=>{for(let i=0;i<128;i++)history.pushState(null,'');return false})()",
    "history entries",
  ],
  [
    "state bytes",
    "(()=>{history.pushState({text:'x'.repeat(70000)},'');return false})()",
    "history state bytes",
  ],
  [
    "URL bytes",
    "(()=>{history.pushState(null,'','/'+ 'x'.repeat(4097));return false})()",
    "history URL bytes",
  ],
])("history %s has an independent limit", async (_name, expression, limit) => {
  const response = await probe(expression);
  expect(response.status).toBe(422);
  expect(JSON.stringify(await response.json())).toContain(`resource limit: ${limit}`);
});
test("history mutation failure leaves the next page fresh", async () => {
  const failure = await probe(
    "(()=>{history.pushState({poison:true},'','/history/changed');document.cookie='poison=yes';globalThis.poison=true;throw new Error('synthetic failure')})()",
  );
  expect(failure.status).toBe(422);
  const response = await probe(
    "({state:history.state,path:location.pathname,cookies:document.cookie,poison:typeof poison})",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { state: null, path: "/history/0", cookies: "", poison: "undefined" },
  });
});
test("history rejects unsupported reload and overlarge state graphs explicitly", async () => {
  for (const expression of [
    "history.go()",
    "(()=>{const value=[];for(let i=0;i<257;i++)value.push({i});history.pushState(value,'')})()",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await probe(expression);
    expect(response.status).toBe(422);
  }
});
