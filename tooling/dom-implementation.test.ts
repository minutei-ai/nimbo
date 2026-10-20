import { afterAll, expect, test } from "bun:test";
import { Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { domImplementationFixture } from "./dom-implementation-fixture";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    domImplementationFixture(new URL(request.url).pathname) ??
    new Response("Not found", { status: 404 }),
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
test.each(Array.from({ length: 64 }, (_, index) => index))(
  "native DOMImplementation hasFeature over HTTP variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL(`/dom-implementation/${variant}`, server.url).href,
        expression: "comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const result = Schema.decodeUnknownSync(Success)(body);
    const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
      result.value,
    );
    expect(Object.keys(checks)).toHaveLength(16);
    expect(Object.values(checks).every((value) => value)).toBe(true);
  },
);
