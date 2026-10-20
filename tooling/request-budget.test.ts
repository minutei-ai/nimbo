import { afterAll, expect, test } from "bun:test";
import { Failure, Input, Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { Miniflare } from "miniflare";

const served: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    served.push(url.pathname + url.search);
    const assets: Record<string, number> = { "/assets": 32, "/assets-max": 127 };
    const count = assets[url.pathname];
    if (count !== undefined)
      return new Response(
        `<script>globalThis.executed=0;</script>${Array.from({ length: count }, (_, index) => `<script src="/script?index=${index}"></script>`).join("")}`,
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/script")
      return new Response("globalThis.executed+=1;", {
        headers: { "content-type": "text/javascript" },
      });
    if (url.pathname === "/fetches")
      return new Response(
        '<script>globalThis.executed=Array.from({length:33}).reduce((previous,_,index)=>previous.then(async count=>{await(await fetch("/value?index="+index)).text();return count+1;}),Promise.resolve(0));</script>',
        { headers: { "content-type": "text/html" } },
      );
    if (url.pathname === "/value") return new Response("value");
    return new Response("<script>globalThis.executed=1;</script>", {
      headers: { "content-type": "text/html" },
    });
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

test.each([
  ["/assets", undefined, 422, 0],
  ["/assets", 32, 422, 0],
  ["/assets", 33, 200, 32],
  ["/assets-max", 128, 200, 127],
  ["/fetches", 64, 200, 33],
  ["/inline", 1, 200, 1],
] as const)("request budget %s/%s returns %i", async (path, maximum, status, expected) => {
  const before = served.length;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(Input))({
      url: new URL(path, server.url).href,
      expression: "executed",
      maxRequests: maximum,
    }),
  });
  expect(response.status).toBe(status);
  const body: unknown = await response.json();
  if (status === 200) {
    expect(Schema.decodeUnknownSync(Success)(body).value).toBe(expected);
    if (path === "/inline") {
      expect(served.length - before).toBe(1);
    } else {
      expect(served.length - before).toBe(expected + 1);
    }
  } else {
    expect(Schema.decodeUnknownSync(Failure)(body).error).toContain("request");
    expect(served.length - before).toBe(32);
  }
});

const UncheckedRequestBudget = Input.mapFields((fields) => ({
  ...fields,
  maxRequests: Schema.Finite,
}));
test.each([0, 129, 1.5])("invalid request budget %s fails before HTTP", async (maximum) => {
  const before = served.length;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: Schema.encodeSync(Schema.fromJsonString(UncheckedRequestBudget))({
      url: new URL("/inline", server.url).href,
      expression: "executed",
      maxRequests: maximum,
    }),
  });
  expect(response.status).toBe(400);
  expect(served.length).toBe(before);
});
