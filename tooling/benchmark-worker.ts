import { benchmarkScenarios } from "./benchmark-fixture";

export async function runWorkerBenchmark(endpoint: URL, origin: URL, token: string) {
  const health = await fetch(new URL("/health", endpoint), { signal: AbortSignal.timeout(30_000) });
  const identity: unknown = await health.json();
  if (
    !health.ok ||
    typeof identity !== "object" ||
    identity === null ||
    Reflect.get(identity, "engine") !== "rust-wasm-quickjs"
  )
    throw new Error("Nimbo health check failed");
  const engine: unknown = Reflect.get(identity, "engine");
  const version: unknown = Reflect.get(identity, "version");
  if (typeof engine !== "string" || typeof version !== "string")
    throw new Error("Invalid Nimbo engine identity");
  const results = [];
  for (const scenario of benchmarkScenarios) {
    const samples = [];
    for (let iteration = 0; iteration < 24; iteration++) {
      const started = performance.now();
      // Sequential samples respect Nimbo's one-page-per-isolate capacity.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const response = await fetch(new URL("/scrape", endpoint), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          url: new URL(scenario.path, origin).href,
          expression: scenario.expression,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      // Reading the result is part of the measured HTTP round trip.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result: unknown = await response.json();
      const elapsed = performance.now() - started;
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        Reflect.get(result, "value") !== scenario.expected ||
        Reflect.get(result, "engine") !== "rust-wasm-quickjs"
      )
        throw new Error(`Invalid benchmark extraction: ${scenario.name} (HTTP ${response.status})`);
      if (iteration >= 3) samples.push(elapsed);
    }
    samples.sort((left, right) => left - right);
    results.push({
      scenario: scenario.name,
      samples: samples.length,
      p50_ms: samples[10],
      p95_ms: samples[19],
      min_ms: samples[0],
      max_ms: samples[20],
    });
  }
  return {
    engine,
    version,
    mode: "HTTP API round trip; real HTTP fixture; 16 rows; concurrency 1; 3 warmups per scenario",
    results,
  };
}

if (import.meta.main) {
  const endpoint = process.env.NIMBO_BENCH_URL,
    origin = process.env.NIMBO_BENCH_ORIGIN,
    token = process.env.NIMBO_API_TOKEN;
  if (!endpoint || !origin || !token)
    throw new Error("Set NIMBO_BENCH_URL, NIMBO_BENCH_ORIGIN and NIMBO_API_TOKEN");
  const result = await runWorkerBenchmark(new URL(endpoint), new URL(origin), token);
  process.stdout.write(
    `${JSON.stringify({ runtime: "operator-supplied Worker endpoint", ...result }, null, 2)}\n`,
  );
}
