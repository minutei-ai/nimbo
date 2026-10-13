import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { extractionCorpus, extractionFixture } from "./extraction-corpus";

let origin: ReturnType<typeof Bun.serve>;
let worker: Miniflare;
beforeAll(() => {
  origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: extractionFixture });
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

test.each([...extractionCorpus])(
  "versioned extraction corpus at default limits: $name",
  async (scenario) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({
        url: new URL(scenario.path, origin.url).href,
        expression: scenario.expression,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      engine: "rust-wasm-quickjs",
      value: scenario.expected,
    });
  },
);
