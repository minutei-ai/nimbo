import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { hotPathFixture, hotPathScenarios } from "./hot-paths-fixture";

const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/stealth.txt", import.meta.url),
).text();
const nativeIdentity: unknown = expect.stringContaining("Nimbo/0.1");
let origin: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/echo")
        return Response.json({
          userAgent: request.headers.get("user-agent"),
          cookie: request.headers.get("cookie"),
          authorization: request.headers.get("authorization"),
        });
      const fixture = hotPathFixture(path);
      if (fixture) return fixture;
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${Number(path.split("/").at(-1)) || 0};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  const root = join(import.meta.dir, "..");
  worker = new Miniflare({
    modules: [
      { type: "ESModule", path: join(root, "dist/worker/index.js") },
      { type: "CompiledWasm", path: join(root, "dist/worker/nimbo_engine_bg.wasm") },
    ],
    compatibilityDate: "2026-07-30",
    bindings: { API_TOKEN: "test-secret" },
  });
});
afterAll(async () => {
  await worker.dispose();
  await origin.stop(true);
});

async function extract(expression: string, path = "/probe/0"): Promise<unknown> {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL(path, origin.url).href,
      expression,
      maxDomOperations: 100000,
      maxLayoutNodes: 4096,
    }),
  });
  const body: unknown = await response.json();
  expect(response.status).toBe(200);
  if (typeof body !== "object" || body === null) throw new Error("Missing extraction response");
  const value: unknown = Reflect.get(body, "value");
  return value;
}

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "owned stealth/compatibility contracts over real HTTP, variant %i",
  async (variant) => {
    const value: unknown = await extract("comparison", `/probe/${variant}`);
    if (typeof value !== "object" || value === null) throw new Error("Missing contracts");
    expect(Object.keys(value)).toHaveLength(22);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("navigator identity agrees with navigation and page-fetch headers", async () => {
  expect(
    await extract(
      "fetch('/echo').then(r=>r.json()).then(r=>({same:r.userAgent===navigator.userAgent,identity:navigator.userAgent,webdriver:navigator.webdriver,secret:r.authorization}))",
    ),
  ).toEqual({
    same: true,
    identity: nativeIdentity,
    webdriver: false,
    secret: null,
  });
});

test("page modules cannot import the owned host bindings", async () => {
  expect(await extract("import('nimbo:bindings').then(()=>false,()=>true)")).toBe(true);
});

test("failed pages dispose poisoned platform state and release capacity", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("/probe/0", origin.url).href,
      expression:
        "(()=>{Object.defineProperty(Navigator.prototype,'userAgent',{get:()=> 'poison'});localStorage.setItem('probe','failed');throw new Error('synthetic failure')})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await extract("({ua:navigator.userAgent,local:localStorage.getItem('probe')})")).toEqual({
    ua: nativeIdentity,
    local: null,
  });
});

test.each(Array.from({ length: 8 }, (_, variant) => variant))(
  "page disposal isolates prototype poisoning, globals, storage and cookies, variant %i",
  async (variant) => {
    expect(
      await extract(
        `(()=>{localStorage.setItem('probe','${variant}');sessionStorage.setItem('probe','${variant}');document.cookie='probe=${variant};path=/';globalThis.process={probe:true};Object.defineProperty(Navigator.prototype,'userAgent',{get:()=> 'poison'});Function.prototype.toString=()=> 'poison';return navigator.userAgent})()`,
      ),
    ).toBe("poison");
    expect(
      await extract(
        "fetch('/echo').then(r=>r.json()).then(r=>({ua:navigator.userAgent,local:localStorage.getItem('probe'),session:sessionStorage.getItem('probe'),cookie:document.cookie,sent:r.cookie,host:typeof process,native:/\\[native code\\]/.test(Function.prototype.toString.call(Object.prototype.toString))}))",
      ),
    ).toEqual({
      ua: nativeIdentity,
      local: null,
      session: null,
      cookie: "",
      sent: null,
      host: "undefined",
      native: true,
    });
  },
);

test.each([...hotPathScenarios])("bounded DOM hot path $name", async (scenario) => {
  expect(await extract(scenario.expression, `/${scenario.name}`)).toBe(true);
});
