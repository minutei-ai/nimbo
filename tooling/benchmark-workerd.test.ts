import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { decodeBudget } from "./benchmark-protocol";
import { processTreeRss } from "./benchmark-memory";
import { startWorkerd } from "./benchmark-workerd";

test("benchmark workerd owns one isolated host with native limits and cleanup", async () => {
  const origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("<!doctype html><title>synthetic</title>", {
        headers: { "content-type": "text/html" },
      }),
  });
  const host = await startWorkerd(resolve(import.meta.dir, "../dist/worker"));
  try {
    const health: unknown = await (await fetch(new URL("/health", host.endpoint))).json();
    if (typeof health !== "object" || health === null) throw new Error("Missing benchmark health");
    expect(decodeBudget(Reflect.get(health, "limits")).max_dom_operations).toBe(10000);
    const response = await fetch(new URL("/scrape", host.endpoint), {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: origin.url.href, expression: "document.title" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      engine: "rust-wasm-quickjs",
      value: "synthetic",
    });
    expect(await processTreeRss(host.pid)).not.toBeNull();
  } finally {
    await host.stop();
    await origin.stop(true);
  }
  expect(await processTreeRss(host.pid)).toBeNull();
}, 30000);
