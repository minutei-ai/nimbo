import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { processTreeRss } from "./benchmark-memory";
import { arch, cpus, loadavg, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { startCelld } from "./benchmark-celld";
import { startWorkerd } from "./benchmark-workerd";
import { corpusVersion, extractionCorpus, extractionFixture } from "./extraction-corpus";
import { corpusOrder, corpusProtocol, decodeBudget, type Budget } from "./benchmark-protocol";
import { regressions, regressionPolicy, summarize } from "./benchmark-statistics";

type Scenario = (typeof extractionCorpus)[number];
export type Runtime = {
  label: string;
  artifact_sha256: string;
  artifact_bytes: number;
  wasm_bytes: number | null;
  host_version: string;
  limits: Budget;
  startup_ms: number | null;
  rss?: () => Promise<number | null>;
  extract: (scenario: Scenario, origin: URL) => Promise<{ value: unknown; rss_kib: number | null }>;
  stop: () => Promise<void>;
};

async function artifact(path: string) {
  const file = Bun.file(path),
    hash = createHash("sha256");
  for await (const chunk of file.stream()) hash.update(chunk);
  return {
    artifact_sha256: hash.digest("hex"),
    artifact_bytes: file.size,
  };
}

export async function nativeRuntime(path: string, label: string): Promise<Runtime> {
  const binary = resolve(path);
  const identity = await artifact(binary);
  const probe = Bun.spawn([binary, "--limits"], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: 5000,
    env: { ...process.env, NIMBO_PROXY_URL: undefined },
  });
  const [configuration, probeExit] = await Promise.all([
    new Response(probe.stdout).text(),
    probe.exited,
  ]);
  if (probeExit !== 0) throw new Error("Native artifact cannot attest its default limits");
  let limits: Budget;
  try {
    limits = decodeBudget(JSON.parse(configuration));
  } catch {
    throw new Error("Native artifact cannot attest its default limits");
  }
  return {
    label,
    ...identity,
    wasm_bytes: null,
    host_version: "native CLI; new process and page per extraction",
    limits,
    startup_ms: null,
    async extract(scenario, origin) {
      const args = [binary, new URL(scenario.path, origin).href, scenario.expression];
      const child = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30000,
        env: { ...process.env, NIMBO_PROXY_URL: undefined },
      });
      const [stdout, , code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error("native-extraction-failed");
      const value: unknown = JSON.parse(stdout);
      const rss = child.resourceUsage()?.maxRSS;
      return { value, rss_kib: rss === undefined ? null : rss / 1024 };
    },
    stop: () => Promise.resolve(),
  };
}

export async function workerRuntime(path: string, label: string): Promise<Runtime> {
  const [wasm, javascript] = await Promise.all([
    Bun.file(join(path, "nimbo_engine_bg.wasm")).arrayBuffer(),
    Bun.file(join(path, "index.js")).arrayBuffer(),
  ]);
  const identity = {
    artifact_sha256: createHash("sha256")
      .update(new Uint8Array(wasm))
      .update(new Uint8Array(javascript))
      .digest("hex"),
    artifact_bytes: wasm.byteLength + javascript.byteLength,
    wasm_bytes: wasm.byteLength,
  };
  const started = performance.now();
  const host =
    process.env.NIMBO_BENCH_WORKER_HOST === "workerd"
      ? await startWorkerd(path)
      : await startCelld(path, { CELLD_MAX_STATELESS_ISOLATES: "1" });
  let limits: Budget;
  try {
    const health = await fetch(new URL("/health", host.endpoint), {
      signal: AbortSignal.timeout(5000),
    });
    const status: unknown = await health.json();
    if (!health.ok || typeof status !== "object" || status === null)
      throw new Error("Missing Worker limit attestation");
    limits = decodeBudget(Reflect.get(status, "limits"));
  } catch {
    await host.stop();
    throw new Error("Worker artifact cannot attest its default limits");
  }
  const startup_ms = performance.now() - started;
  return {
    label,
    ...identity,
    host_version: host.version,
    limits,
    startup_ms,
    async extract(scenario, origin) {
      const response = await fetch(new URL("/scrape", host.endpoint), {
        method: "POST",
        headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          url: new URL(scenario.path, origin).href,
          expression: scenario.expression,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        Reflect.get(body, "engine") !== "rust-wasm-quickjs"
      )
        throw new Error(`worker-extraction-failed-${response.status}`);
      return { value: Reflect.get(body, "value"), rss_kib: null };
    },
    stop: host.stop,
    // Retained host memory is sampled separately, outside the extraction timer.
    rss: () => processTreeRss(host.pid),
  };
}

export async function corpusIdentity(): Promise<string> {
  return (
    await Promise.all(
      ["extraction-corpus.ts", "benchmark-fixture.ts", "hot-paths-fixture.ts"].map((file) =>
        readFile(join(import.meta.dir, file)),
      ),
    )
  )
    .reduce(
      (hash, bytes) => hash.update(bytes),
      createHash("sha256").update(JSON.stringify(extractionCorpus)),
    )
    .digest("hex");
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "native" && mode !== "worker")
    throw new Error("Usage: benchmark-corpus.ts native|worker [candidate] [baseline]");
  const candidate =
    process.argv[3] ?? (mode === "native" ? "target/release/nimbo-engine" : "dist/worker");
  const baseline = process.argv[4];
  const { warmups, samples, rounds } = corpusProtocol;
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: extractionFixture });
  const loadBefore = loadavg();
  const runtimes: Runtime[] = [];
  const results: {
    runtime: string;
    scenario: string;
    round: number;
    cold_ms: number | null;
    valid: number;
    failures: number;
    samples_ms: number[];
    rss_kib: number[];
  }[] = [];
  try {
    const create = mode === "native" ? nativeRuntime : workerRuntime;
    for (const [label, path] of baseline
      ? [
          ["baseline", baseline],
          ["candidate", candidate],
        ]
      : [["candidate", candidate]]) {
      if (!label || !path) throw new Error("Missing runtime argument");
      // Separate hosts allow alternating A/B samples without reusing page state.
      // oxlint-disable-next-line eslint/no-await-in-loop
      runtimes.push(await create(path, label));
    }
    for (let round = 0; round < rounds; round++) {
      for (const scenario of extractionCorpus) {
        const entries = runtimes.map((runtime) => ({
          runtime: runtime.label,
          scenario: scenario.name,
          round,
          cold_ms: null as number | null,
          valid: 0,
          failures: 0,
          samples_ms: [] as number[],
          rss_kib: [] as number[],
        }));
        results.push(...entries);
        for (let iteration = 0; iteration < warmups + samples; iteration++) {
          for (let offset = 0; offset < runtimes.length; offset++) {
            const index = (round + iteration + offset) % runtimes.length;
            const runtime = runtimes[index],
              entry = entries[index];
            if (!runtime || !entry) throw new Error("Missing runtime");
            const started = performance.now();
            try {
              // Sequential work preserves the host's one-page capacity.
              // oxlint-disable-next-line eslint/no-await-in-loop
              const extraction = await runtime.extract(scenario, fixture.url);
              const elapsed = performance.now() - started;
              if (extraction.value !== scenario.expected) throw new Error("incorrect-extraction");
              entry.valid++;
              if (round === 0 && iteration === 0) entry.cold_ms = elapsed;
              if (iteration >= warmups) {
                entry.samples_ms.push(elapsed);
                // oxlint-disable-next-line eslint/no-await-in-loop
                const rss = runtime.rss ? await runtime.rss() : extraction.rss_kib;
                if (rss !== null) entry.rss_kib.push(rss);
              }
            } catch {
              // Never publish page content, operational URLs or child stderr.
              entry.failures++;
            }
          }
        }
      }
    }
    const comparisons = results
      .filter((entry) => entry.runtime === "candidate")
      .flatMap((entry) => {
        const before = results.find(
          (other) =>
            other.runtime === "baseline" &&
            other.scenario === entry.scenario &&
            other.round === entry.round,
        );
        if (!before || before.failures || entry.failures) return [];
        return [
          {
            scenario: entry.scenario,
            round: entry.round,
            regressions: regressions(before, entry),
            missing_memory_samples:
              before.rss_kib.length !== samples || entry.rss_kib.length !== samples,
          },
        ];
      });
    const report = {
      schema_version: 2,
      corpus_version: corpusVersion,
      corpus_sha256: await corpusIdentity(),
      date: new Date().toISOString(),
      host: mode,
      environment: {
        os: platform(),
        kernel: release(),
        architecture: arch(),
        cpu: cpus()[0]?.model ?? "unknown",
        logical_cpus: cpus().length,
        ram_bytes: totalmem(),
        bun: Bun.version,
        configured_rust_toolchain:
          (await Bun.file(join(import.meta.dir, "../rust-toolchain.toml")).text()).match(
            /channel = "([^"]+)"/,
          )?.[1] ?? "unknown",
        load_average_before: loadBefore,
        load_average_after: loadavg(),
      },
      protocol: {
        warmups,
        samples,
        rounds,
        concurrency: 1,
        budget_mode: "artifact-defaults",
        host_isolates: mode === "worker" ? 1 : null,
        order: corpusOrder,
        limits: "artifact-attested default page budgets; no request overrides",
        timing:
          mode === "native"
            ? "process creation through output and exit"
            : "HTTP API round trip through consumed result; startup measured separately",
        memory:
          mode === "native"
            ? "per-process peak RSS via Bun subprocess resourceUsage"
            : "Linux host process-tree RSS after requests; includes runtime; not peak or page heap",
        cold:
          mode === "native"
            ? "fresh process per extraction; cold_ms records the first observed sample per scenario"
            : "first observed extraction per scenario; only the first scenario starts a cold host",
        policy: regressionPolicy,
      },
      runtimes: runtimes.map(
        ({
          label,
          artifact_sha256,
          artifact_bytes,
          wasm_bytes,
          host_version,
          startup_ms,
          limits,
        }) => ({
          label,
          artifact_sha256,
          artifact_bytes,
          wasm_bytes,
          host_version,
          startup_ms,
          limits,
        }),
      ),
      results: results.map((entry) => ({
        ...entry,
        statistics: entry.samples_ms.length ? summarize(entry) : null,
      })),
      comparisons,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (
      results.some((entry) => entry.failures > 0) ||
      comparisons.some((entry) => entry.regressions.length > 0 || entry.missing_memory_samples)
    )
      process.exitCode = 1;
  } finally {
    try {
      await Promise.all(runtimes.map((runtime) => runtime.stop()));
    } finally {
      await fixture.stop(true);
    }
  }
}
