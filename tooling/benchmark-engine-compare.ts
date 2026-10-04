import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { startCelld } from "./benchmark-celld";
import { benchmarkFixture, comparisonScenarios } from "./benchmark-fixture";

const baseline = process.env.NIMBO_BENCH_BASELINE_BUNDLE;
if (!baseline) throw new Error("NIMBO_BENCH_BASELINE_BUNDLE is required");
const bundles = [baseline, resolve(import.meta.dir, "../dist/worker")];
const hosts: Awaited<ReturnType<typeof startCelld>>[] = [];
const requests = new Map<string, number>();
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url),
      key = url.pathname + url.search;
    requests.set(key, (requests.get(key) ?? 0) + 1);
    return benchmarkFixture(request);
  },
});
type Result = {
  runtime: string;
  scenario: string;
  valid: number;
  failures: Record<string, number>;
  samples_ms: number[];
};
const results: Result[] = [];
try {
  const runtimes = [];
  for (const [index, bundle] of bundles.entries()) {
    // Start each owned host sequentially; no benchmark runs during startup.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const host = await startCelld(bundle);
    hosts.push(host);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const bytes = await Bun.file(join(bundle, "nimbo_engine_bg.wasm")).arrayBuffer();
    runtimes.push({
      name: index === 0 ? "baseline" : "candidate",
      version: host.version,
      wasm_sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    });
  }
  for (const scenario of comparisonScenarios) {
    const entries: Result[] = runtimes.map((runtime) => ({
      runtime: runtime.name,
      scenario: scenario.name,
      valid: 0,
      failures: {},
      samples_ms: [],
    }));
    results.push(...entries);
    for (let iteration = 0; iteration < 24; iteration++) {
      for (let offset = 0; offset < hosts.length; offset++) {
        const index = (iteration + offset) % hosts.length,
          host = hosts[index],
          entry = entries[index];
        if (!host || !entry) throw new Error("Missing benchmark host");
        const started = performance.now();
        try {
          // Alternate sequential extractions from the two engines on identical input.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const response = await fetch(new URL("/scrape", host.endpoint), {
            method: "POST",
            headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
            body: JSON.stringify({
              url: new URL(scenario.path, fixture.url).href,
              expression: scenario.expression,
            }),
            signal: AbortSignal.timeout(30000),
          });
          // oxlint-disable-next-line eslint/no-await-in-loop
          const result: unknown = await response.json();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (
            typeof result !== "object" ||
            result === null ||
            Reflect.get(result, "engine") !== "rust-wasm-quickjs"
          )
            throw new Error("Unexpected engine identity");
          if (Reflect.get(result, "value") !== scenario.expected)
            throw new Error("Wrong extraction value");
          entry.valid++;
          if (iteration >= 3) entry.samples_ms.push(performance.now() - started);
        } catch (error) {
          const category = error instanceof Error ? error.message : "Unknown failure";
          entry.failures[category] = (entry.failures[category] ?? 0) + 1;
        }
      }
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        mode: "two persistent local celld hosts; same authenticated HTTP adapter; fresh pages; concurrency 1; alternating engine order; 3 excluded warmups and 21 measured attempts per scenario; default limits; real HTTP and JavaScript; no mocks",
        runtimes,
        results: results.map(({ samples_ms, ...entry }) => {
          const ordered = samples_ms.toSorted((a, b) => a - b);
          return Object.assign(entry, {
            samples_ms,
            measured: samples_ms.length,
            p50_ms: samples_ms.length ? ordered[Math.floor(ordered.length * 0.5)] : null,
            p95_ms: samples_ms.length ? ordered[Math.floor(ordered.length * 0.95)] : null,
          });
        }),
        fixture_requests: Object.fromEntries(requests),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await Promise.all(hosts.map((host) => host.stop()));
  await fixture.stop(true);
}
