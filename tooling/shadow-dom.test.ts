import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { shadowDomFixture } from "./shadow-dom-fixture";
let server: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) =>
      shadowDomFixture(new URL(r.url).pathname) ?? new Response("Not found", { status: 404 }),
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
  "owned Shadow DOM over HTTP, variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({
        url: new URL(`/shadow-dom/${variant}`, server.url).href,
        expression: "comparison",
      }),
    });
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(57);
    expect(Object.entries(value).filter(([, result]) => result !== true)).toEqual([]);
  },
);

const probe = (expression: string, maxDomOperations = 10000) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({
      url: new URL("/shadow-dom/0", server.url).href,
      expression,
      scripts: "skip",
      maxDomOperations,
    }),
  });

test("shadow root allocation has an independent limit", async () => {
  const response = await probe(
    "(()=>{for(let i=0;i<129;i++)document.createElement('div').attachShadow({mode:'open'});return false})()",
    100000,
  );
  expect(response.status).toBe(422);
  const body: unknown = await response.json();
  expect(JSON.stringify(body)).toContain("resource limit: shadow root count");
});

test("shadow mutation failure disposes roots, globals and capacity", async () => {
  const failure = await probe(
    "(()=>{const root=document.body.attachShadow({mode:'closed'});root.innerHTML='<p id=poison>private</p>';globalThis.poison=true;throw new Error('synthetic failure')})()",
  );
  expect(failure.status).toBe(422);
  const response = await probe(
    "({root:document.body.shadowRoot,poison:typeof poison,node:document.querySelector('#poison')})",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { root: null, poison: "undefined", node: null },
  });
});

test("unimplemented shadow layout and options fail explicitly", async () => {
  for (const expression of [
    "(()=>{const host=document.createElement('div');document.body.appendChild(host);host.attachShadow({mode:'open'});return host.getBoundingClientRect()})()",
    "document.createElement('div').attachShadow({mode:'open',delegatesFocus:true})",
    "document.createElement('div').attachShadow({mode:'open',slotAssignment:'manual'})",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await probe(expression);
    expect(response.status).toBe(422);
  }
});

test("shadow traversal keeps the shared DOM operation budget", async () => {
  const response = await probe(
    "(()=>{const root=document.body.attachShadow({mode:'open'});for(let i=0;i<100;i++)root.appendChild(document.createElement('span'));return true})()",
    32,
  );
  expect(response.status).toBe(422);
  const body: unknown = await response.json();
  expect(JSON.stringify(body)).toContain("resource limit: DOM operations");
});
