import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeBudget } from "./benchmark-protocol";
import { ownedWorkerdMemory, processTreeRss } from "./benchmark-memory";
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
    const memory = await ownedWorkerdMemory(host.pid);
    if (memory === null || memory.rss_high_water_kib === null)
      throw new Error("Missing owned workerd memory");
    expect(memory.rss_kib).toBeGreaterThan(0);
    expect(memory.rss_high_water_kib).toBeGreaterThan(0);
  } finally {
    await host.stop();
    await origin.stop(true);
  }
  expect(await processTreeRss(host.pid)).toBeNull();
  expect(await ownedWorkerdMemory(host.pid)).toBeNull();
}, 30000);

test("memory attribution rejects multiple workerd processes under one owner", async () => {
  const directory = resolve(import.meta.dir, "../dist/worker");
  const first = await startWorkerd(directory);
  try {
    const second = await startWorkerd(directory);
    try {
      expect(await ownedWorkerdMemory(process.pid)).toBeNull();
      expect(await ownedWorkerdMemory(first.pid)).not.toBeNull();
      expect(await ownedWorkerdMemory(second.pid)).not.toBeNull();
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
  }
}, 30000);

test("benchmark workerd loads an immutable bundle outside the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nimbo-benchmark-bundle-"));
  try {
    await cp(resolve(import.meta.dir, "../dist/worker"), directory, { recursive: true });
    const host = await startWorkerd(directory);
    try {
      const response = await fetch(new URL("/health", host.endpoint));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ engine: "rust-wasm-quickjs" });
    } finally {
      await host.stop();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
