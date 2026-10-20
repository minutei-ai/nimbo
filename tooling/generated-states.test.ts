import { afterAll, expect, test } from "bun:test";
import { Failure, Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { generatedStatesFixture } from "./generated-states-fixture";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    generatedStatesFixture(new URL(request.url).pathname) ??
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
  "native generated selector states over HTTP variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: Schema.encodeSync(Schema.fromJsonString(Input))({
        url: new URL(`/generated-states/${variant}`, server.url).href,
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

test("native stateless generated selectors retain logical matching and specificity", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/generated-states/logical", server.url).href,
      expression: "comparison",
    }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(Success)(body).value).toEqual({ height: 9, width: "27px" });
});

test("invalid generated sub-pseudo selectors retain stylesheet recovery", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/generated-states/sub-pseudo", server.url).href,
      expression: "comparison",
    }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(Success)(body).value).toBe("0px");
});

test("late charset rules recover without changing decoded stylesheet rules", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/generated-states/charset", server.url).href,
      expression:
        "({first:getComputedStyle(document.getElementById('first')).width,late:getComputedStyle(document.getElementById('late')).height,duplicate:getComputedStyle(document.getElementById('duplicate')).width,group:getComputedStyle(document.getElementById('group')).height,discard:getComputedStyle(document.getElementById('discard')).height,following:getComputedStyle(document.getElementById('following')).width})",
    }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(Success)(body).value).toEqual({
    first: "17px",
    late: "19px",
    duplicate: "21px",
    group: "23px",
    discard: "29px",
    following: "31px",
  });
});

test("unsupported at-rules still fail explicitly", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL("/generated-states/unknown-rule", server.url).href,
      expression: "getComputedStyle(document.querySelector('div')).height",
    }),
  });
  expect(response.status).toBe(422);
  const body: unknown = await response.json();
  expect(Schema.decodeUnknownSync(Failure)(body).error).toContain(
    "stylesheet at-rule: unknown-foo",
  );
});
