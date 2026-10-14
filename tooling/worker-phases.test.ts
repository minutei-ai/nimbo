import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";

let origin: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // Hanging routes must outlive the engine's 10 s deadline, not Bun's idle timeout.
    idleTimeout: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/status" || path === "/missing.js")
        return new Response("missing", { status: 404 });
      if (path === "/hang") return new Promise<Response>(() => {});
      const body =
        path === "/scripts"
          ? "<script>throw new Error('synthetic script failure')</script>"
          : path === "/modules"
            ? "<script type=module>import '/missing.js'</script>"
            : "<body><div>fresh</div></body>";
      return new Response(body, { headers: { "content-type": "text/html" } });
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

const run = (path: string, options: object = {}) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL(path, origin.url).href,
      expression: "typeof poisoned",
      ...options,
    }),
  });

test.each([
  {
    name: "HTTP navigation",
    path: "/status",
    options: {},
    status: 502,
    phase: "navigation",
    enginePhase: undefined,
  },
  {
    name: "initial node quota",
    path: "/",
    options: { maxInitialDomNodes: 3 },
    status: 422,
    phase: "parsing",
    enginePhase: undefined,
  },
  {
    name: "inline script",
    path: "/scripts",
    options: {},
    status: 422,
    phase: "execution",
    enginePhase: "scripts",
  },
  {
    name: "module response",
    path: "/modules",
    options: {},
    status: 422,
    phase: "resource",
    enginePhase: "scripts",
  },
  {
    name: "synchronous extraction",
    path: "/",
    options: { expression: "(()=>{globalThis.poisoned=true;throw new Error('synthetic')})()" },
    status: 422,
    phase: "extraction",
    enginePhase: "ready",
  },
  {
    name: "rejected extraction",
    path: "/",
    options: { expression: "Promise.reject(new Error('synthetic'))" },
    status: 422,
    phase: "extraction",
    enginePhase: "evaluating",
  },
  {
    name: "readiness deadline",
    path: "/",
    options: {
      waitFor: {
        condition: { type: "selector", selector: ".missing" },
        timeoutMs: 25,
        pollIntervalMs: 5,
      },
    },
    status: 422,
    phase: "readiness",
    enginePhase: "waiting",
  },
])("optional failure phases: $name", async ({ path, options, status, phase, enginePhase }) => {
  const response = await run(path, { ...options, diagnostics: true });
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({
    diagnostics: { phase, ...(enginePhase === undefined ? {} : { enginePhase }), cancelled: false },
  });
  const fresh = await run("/");
  expect(fresh.status).toBe(200);
  expect(await fresh.json()).toMatchObject({ value: "undefined" });
});

test.each([undefined, false])(
  "ordinary failures omit optional phase metadata (%s)",
  async (diagnostics) => {
    const response = await run("/status", { diagnostics });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "navigation HTTP 404" });
  },
);

test("host deadline is distinct from client cancellation and releases navigation", async () => {
  const response = await run("/hang", { diagnostics: true });
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({
    error: "scrape deadline or invalid input",
    diagnostics: { phase: "navigation", cancelled: false },
  });
  expect((await run("/")).status).toBe(200);
}, 15000);
