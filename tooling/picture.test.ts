import { afterAll, expect, test } from "bun:test";
import { Failure, Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { pictureFixture } from "./picture-fixture";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    pictureFixture(new URL(request.url).pathname) ?? new Response("Not found", { status: 404 }),
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
  "native picture selection and mutations over HTTP variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL(`/pictures/${variant}`, server.url).href,
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

test.each([
  [131, "large.png", 64],
  [132, "large.png", 64],
  [133, "small.png", 32],
] as const)("picture uses the requested viewport width %i", async (width, name, naturalWidth) => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/pictures/threshold", server.url).href,
      media: { width },
      expression: "comparison",
    }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(Success)(body).value).toEqual({
    url: `/pictures/${name}`,
    width: naturalWidth,
  });
});

test.each([
  ["width", "image width descriptors and sizes"],
  ["bytes", "image srcset bytes"],
] as const)("picture retains the %s boundary", async (name, message) => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL(`/pictures/${name}`, server.url).href,
      expression: "true",
    }),
  });
  expect(response.status).toBe(422);
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(Failure)(body).error).toContain(message);
});
