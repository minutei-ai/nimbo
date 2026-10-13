import { arch, cpus, loadavg, platform } from "node:os";
import { nativeRuntime, workerRuntime, corpusIdentity, type Runtime } from "./benchmark-corpus";
import { corpusVersion, extractionCorpus, extractionFixture } from "./extraction-corpus";
import { percentile } from "./benchmark-statistics";

const mode = process.argv[2];
if (mode !== "native" && mode !== "worker")
  throw new Error("Usage: benchmark-load.ts native|worker [artifact] [concurrency=4] [seconds=30]");
const artifact =
  process.argv[3] ?? (mode === "native" ? "target/release/nimbo-engine" : "dist/worker");
const concurrency = Number(process.argv[4] ?? 4),
  seconds = Number(process.argv[5] ?? 30);
if (
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 32 ||
  !Number.isInteger(seconds) ||
  seconds < 1 ||
  seconds > 300
)
  throw new Error("Concurrency must be 1..32; duration must be 1..300 seconds");
const cap = process.env.CELLD_MAX_STATELESS_ISOLATES;
const workerIsolateCap = mode === "worker" && cap !== undefined ? Number(cap) : null;
if (workerIsolateCap !== null && (!Number.isSafeInteger(workerIsolateCap) || workerIsolateCap < 1))
  throw new Error("Invalid configured Worker isolate cap");
const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: extractionFixture });
let runtime: Runtime | undefined;
const sampleLimit = 10000;
const rows = extractionCorpus.map((scenario) => ({
  scenario: scenario.name,
  attempted: 0,
  accepted: 0,
  rejected: 0,
  failures: 0,
  samples_ms: [] as number[],
  peak_native_rss_kib: null as number | null,
}));
const hostMemory: number[] = [];
const stopSampling = new AbortController();
let sampler: Promise<void> | undefined;
try {
  runtime = await (mode === "native" ? nativeRuntime : workerRuntime)(artifact, mode);
  const host = runtime;
  sampler = (async () => {
    while (!stopSampling.signal.aborted && host.rss) {
      // Sample process-tree RSS outside extraction timing; it includes the host runtime.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const rss = await host.rss();
      if (rss !== null) hostMemory.push(rss);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await Bun.sleep(250);
    }
  })();
  const started = performance.now(),
    deadline = started + seconds * 1000;
  const loadBefore = loadavg();
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline && next < 1000000) {
        const index = next++ % extractionCorpus.length;
        const scenario = extractionCorpus[index],
          row = rows[index];
        if (!scenario || !row) throw new Error("Missing load scenario");
        row.attempted++;
        const began = performance.now();
        try {
          // Each lane owns at most one outstanding extraction.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const result = await host.extract(scenario, fixture.url);
          if (result.value !== scenario.expected) {
            row.failures++;
            continue;
          }
          row.accepted++;
          if (row.samples_ms.length < sampleLimit) row.samples_ms.push(performance.now() - began);
          if (result.rss_kib !== null)
            row.peak_native_rss_kib = Math.max(row.peak_native_rss_kib ?? 0, result.rss_kib);
        } catch (cause) {
          // Admission refusals are rejected work, never successful throughput or runtime failures.
          if (cause instanceof Error && cause.message === "worker-extraction-failed-429")
            row.rejected++;
          else row.failures++;
        }
      }
    }),
  );
  const elapsed_ms = performance.now() - started;
  stopSampling.abort();
  await sampler;
  const recoveryScenario = extractionCorpus[0];
  const recovery = await host
    .extract(recoveryScenario, fixture.url)
    .then((result) => result.value === recoveryScenario.expected)
    .catch(() => false);
  const accepted = rows.reduce((total, row) => total + row.accepted, 0);
  const report = {
    schema_version: 1,
    corpus_sha256: await corpusIdentity(),
    worker_isolate_cap: workerIsolateCap,
    date: new Date().toISOString(),
    corpus_version: corpusVersion,
    scope:
      "bounded local host load; fresh pages; not production capacity or a controlled regression gate",
    host: {
      platform: platform(),
      architecture: arch(),
      cpus: cpus().length,
      load_before: loadBefore,
      load_after: loadavg(),
    },
    runtime: {
      mode,
      version: host.host_version,
      artifact_sha256: host.artifact_sha256,
      artifact_bytes: host.artifact_bytes,
      wasm_bytes: host.wasm_bytes,
    },
    concurrency,
    requested_seconds: seconds,
    elapsed_ms,
    attempted: next,
    accepted,
    accepted_per_second: accepted / (elapsed_ms / 1000),
    recovery,
    latency_sample_limit_per_scenario: sampleLimit,
    scenarios: rows.map(({ samples_ms, ...row }) => ({
      ...row,
      latency_samples: samples_ms.length,
      p50_ms: samples_ms.length ? percentile(samples_ms, 0.5) : null,
      p95_ms: samples_ms.length ? percentile(samples_ms, 0.95) : null,
    })),
    worker_host_process_tree_rss_kib: hostMemory.length
      ? {
          initial: hostMemory[0],
          peak: Math.max(...hostMemory),
          final: hostMemory.at(-1),
          samples: hostMemory.length,
        }
      : null,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!recovery || rows.some((row) => row.failures > 0 || row.accepted === 0)) process.exitCode = 1;
} finally {
  stopSampling.abort();
  if (sampler) await sampler;
  try {
    if (runtime) await runtime.stop();
  } finally {
    await fixture.stop(true);
  }
}
