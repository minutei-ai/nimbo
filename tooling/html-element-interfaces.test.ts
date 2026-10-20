import { afterAll, expect, test } from "bun:test";
import { Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { htmlElementInterfacesFixture } from "./html-element-interfaces-fixture";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    htmlElementInterfacesFixture(new URL(request.url).pathname) ??
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
  "native HTML element interfaces over HTTP variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL(`/html-element-interfaces/${variant}`, server.url).href,
        expression:
          '(() => { for (const name of ["HTMLMediaElement", "HTMLFrameSetElement", "HTMLBodyElement", "HTMLFrameElement"]) void globalThis[name].prototype; return comparison; })()',
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const result = Schema.decodeUnknownSync(Success)(body);
    const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
      result.value,
    );
    expect(Object.keys(checks)).toHaveLength(35);
    expect(Object.values(checks).every((value) => value)).toBe(true);
  },
);
