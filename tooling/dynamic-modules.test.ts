import { afterAll, expect, test } from "bun:test";
import { Failure, Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { dynamicModulesFixture } from "./dynamic-modules-fixture";

const requested: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    requested.push(path);
    return dynamicModulesFixture(path) ?? new Response("Not found", { status: 404 });
  },
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
  "dynamic module graphs retain identity and live exports over HTTP variant %i",
  async (variant) => {
    const path = `/dynamic-modules/${variant}`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL(path, server.url).href,
        expression: "comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const result = Schema.decodeUnknownSync(Success)(body);
    const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
      result.value,
    );
    expect(Object.keys(checks)).toHaveLength(8);
    expect(Object.values(checks).every((value) => value)).toBe(true);
    expect(requested.filter((url) => url === `${path}/graph/root.js`)).toHaveLength(1);
    expect(requested.filter((url) => url === `${path}/graph/dependency.js`)).toHaveLength(1);
  },
);

test("dynamic module failures retain native errors and allow failed network loads to retry", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/dynamic-modules/errors", server.url).href,
      expression: "comparison",
    }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const result = Schema.decodeUnknownSync(Success)(body);
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(12);
  expect(checks).toEqual(Object.fromEntries(Object.keys(checks).map((key) => [key, true])));
  expect(requested.filter((path) => path === "/dynamic-modules/errors/missing.js")).toHaveLength(2);
  expect(
    requested.filter((path) => path === "/dynamic-modules/errors/shared-missing.js"),
  ).toHaveLength(2);
  expect(requested).not.toContain("/dynamic-modules/errors/never.js");
});

test("dynamic graphs retain the shared request budget", async () => {
  const denied = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/dynamic-modules/65", server.url).href,
      expression: "comparison.catch(()=>true)",
      maxRequests: 2,
    }),
  });
  expect(denied.status).toBe(422);
  const failure: unknown = await denied.json();
  expect(Schema.decodeUnknownSync(Failure)(failure).error).toContain("request");
  const allowed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/dynamic-modules/66", server.url).href,
      expression: "comparison",
      maxRequests: 3,
    }),
  });
  expect(allowed.status).toBe(200);
  const success: unknown = await allowed.json();
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    Schema.decodeUnknownSync(Success)(success).value,
  );
  expect(Object.values(checks).every((value) => value)).toBe(true);
});
