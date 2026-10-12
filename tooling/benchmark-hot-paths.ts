import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { startCelld } from "./benchmark-celld";
import { hotPathFixture, hotPathScenarios } from "./hot-paths-fixture";

async function processTreeRss(pid: number): Promise<number | null> {
  try {
    const [status, children] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/task/${pid}/children`, "utf8"),
    ]);
    const own = /VmRSS:\s+(\d+)\s+kB/.exec(status)?.[1];
    if (!own) return null;
    const descendants = await Promise.all(
      children
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((child) => processTreeRss(Number(child))),
    );
    return Number(own) + descendants.reduce<number>((total, value) => total + (value ?? 0), 0);
  } catch {
    return null;
  }
}

const baseline = process.env.NIMBO_BENCH_BASELINE_BUNDLE;
const bundles = baseline
  ? [baseline, resolve(import.meta.dir, "../dist/worker")]
  : [resolve(import.meta.dir, "../dist/worker")];
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    hotPathFixture(new URL(request.url).pathname) ?? new Response("Not found", { status: 404 }),
});
const hosts: Awaited<ReturnType<typeof startCelld>>[] = [];
const results: {
  runtime: string;
  scenario: string;
  valid: number;
  failures: Record<string, number>;
  samples_ms: number[];
  rss_after_request_kib: number[];
}[] = [];
try {
  for (const bundle of bundles) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    hosts.push(await startCelld(bundle));
  }
  for (const scenario of hotPathScenarios) {
    const entries = hosts.map((_, index) => ({
      runtime: baseline && index === 0 ? "baseline" : "candidate",
      scenario: scenario.name,
      valid: 0,
      failures: {} as Record<string, number>,
      samples_ms: [] as number[],
      rss_after_request_kib: [] as number[],
    }));
    results.push(...entries);
    for (let iteration = 0; iteration < 18; iteration++) {
      for (let offset = 0; offset < hosts.length; offset++) {
        const index = (iteration + offset) % hosts.length,
          host = hosts[index],
          entry = entries[index];
        if (!host || !entry) throw new Error("Missing benchmark host");
        const start = performance.now();
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop
          const response = await fetch(new URL("/scrape", host.endpoint), {
            method: "POST",
            headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
            body: JSON.stringify({
              url: new URL(scenario.name, fixture.url).href,
              expression: scenario.expression,
              maxDomOperations: 100000,
              maxLayoutNodes: 4096,
            }),
            signal: AbortSignal.timeout(30000),
          });
          // oxlint-disable-next-line eslint/no-await-in-loop
          const body: unknown = await response.json();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (typeof body !== "object" || body === null || Reflect.get(body, "value") !== true)
            throw new Error("Wrong extraction value");
          entry.valid++;
          if (iteration >= 3) {
            entry.samples_ms.push(performance.now() - start);
            // Sample after the timing window; this is host RSS, not page heap/peak.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const rss = await processTreeRss(host.pid);
            if (rss !== null) entry.rss_after_request_kib.push(rss);
          }
        } catch (error) {
          const category = error instanceof Error ? error.message : "Unknown failure";
          entry.failures[category] = (entry.failures[category] ?? 0) + 1;
        }
      }
    }
  }
  const hashes = [];
  for (const [index, bundle] of bundles.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const bytes = await Bun.file(join(bundle, "nimbo_engine_bg.wasm")).arrayBuffer();
    hashes.push({
      runtime: baseline && index === 0 ? "baseline" : "candidate",
      wasm_sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    });
  }
  process.stdout.write(
    JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        mode: "local celld; real HTTP; fresh pages; alternating builds; concurrency 1; 3 warmups + 15 measured runs; Linux process-tree RSS sampled after requests, not peak/page heap; DOM budget 100000; layout nodes 4096",
        runtimes: hashes,
        results: results.map((entry) => {
          const samples = entry.samples_ms.toSorted((a, b) => a - b);
          return {
            ...entry,
            p50_ms: samples[Math.floor(samples.length * 0.5)] ?? null,
            p95_ms: samples[Math.floor(samples.length * 0.95)] ?? null,
            max_rss_after_request_kib: entry.rss_after_request_kib.length
              ? Math.max(...entry.rss_after_request_kib)
              : null,
          };
        }),
      },
      null,
      2,
    ) + "\n",
  );
  if (results.some((entry) => entry.valid !== 18)) process.exitCode = 1;
} finally {
  await Promise.all(hosts.map((host) => host.stop()));
  await fixture.stop(true);
}
