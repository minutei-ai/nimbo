import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { mutationObserverFixture } from "./mutation-observer-fixture";
let server: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) =>
      mutationObserverFixture(new URL(r.url).pathname) ??
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
  "owned MutationObserver over HTTP, variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({
        url: new URL(`/mutation-observer/${variant}`, server.url).href,
        expression: "comparison",
      }),
    });
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(40);
    expect(Object.entries(value).filter(([, result]) => result !== true)).toEqual([]);
  },
);

const probe = (expression: string, maxDomOperations = 100000) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({
      url: new URL("/mutation-observer/0", server.url).href,
      scripts: "skip",
      expression,
      maxDomOperations,
    }),
  });

test.each([
  [
    "observer count",
    "(()=>{for(let i=0;i<129;i++)new MutationObserver(()=>{});return false})()",
    "mutation observer count",
  ],
  [
    "record retention",
    "(()=>{const o=new MutationObserver(()=>{});o.observe(document.body,{attributes:true});for(let i=0;i<4097;i++)document.body.setAttribute('data-value',String(i));return false})()",
    "mutation records",
  ],
  [
    "attribute filter",
    "(()=>{new MutationObserver(()=>{}).observe(document.body,{attributeFilter:Array(129).fill('data-value')});return false})()",
    "mutation attribute filter",
  ],
])("mutation %s has an independent limit", async (_name, expression, limit) => {
  const response = await probe(expression);
  expect(response.status).toBe(422);
  expect(JSON.stringify(await response.json())).toContain(`resource limit: ${limit}`);
});

test("observer traversal uses the shared DOM budget", async () => {
  const response = await probe(
    "(()=>{for(let i=0;i<20;i++)new MutationObserver(()=>{}).observe(document.body,{attributes:true,subtree:true});document.body.id='bounded';return false})()",
    32,
  );
  expect(response.status).toBe(422);
  expect(JSON.stringify(await response.json())).toContain("resource limit: DOM operations");
});

test("mutation failure releases queues, globals and observer capacity", async () => {
  const failure = await probe(
    "(()=>{const o=new MutationObserver(()=>{});o.observe(document.body,{attributes:true});document.body.id='poison';globalThis.poison=o;throw new Error('synthetic observer failure')})()",
  );
  expect(failure.status).toBe(422);
  const response = await probe(
    "({poison:typeof poison,id:document.body.id,records:new MutationObserver(()=>{}).takeRecords().length})",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { poison: "undefined", id: "", records: 0 },
  });
});
