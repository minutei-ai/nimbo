import { expect, test } from "bun:test";
import { evaluateBenchmark } from "./benchmark-gate";
import { corpusOrder, corpusProtocol } from "./benchmark-protocol";
import { regressionPolicy } from "./benchmark-statistics";
import { corpusVersion, extractionCorpus } from "./extraction-corpus";

const identity = "a".repeat(64);
const limits = {
  max_javascript_ticks: 512,
  max_microtasks: 10000,
  max_timers: 1024,
  max_timer_tasks: 10000,
  max_expression_bytes: 65536,
  timeout: { secs: 10, nanos: 0 },
  max_response_bytes: 2097152,
  max_initial_dom_nodes: 65536,
  max_dom_nodes: 65536,
  max_stylesheet_bytes: 262144,
  max_stylesheet_selectors: 4096,
  max_requests: 32,
  max_dom_operations: 10000,
  max_layout_nodes: 1024,
  max_dom_write_bytes: 4194304,
  max_storage_bytes: 65536,
  javascript_memory_bytes: 33554432,
};
function report() {
  return {
    schema_version: 2,
    corpus_version: corpusVersion,
    corpus_sha256: identity,
    host: "native",
    environment: {
      os: "linux",
      kernel: "test",
      architecture: "x64",
      cpu: "synthetic",
      logical_cpus: 2,
      ram_bytes: 1000000,
      bun: "test",
      configured_rust_toolchain: "test",
      load_average_before: [0, 0, 0],
      load_average_after: [0, 0, 0],
    },
    protocol: {
      ...corpusProtocol,
      budget_mode: "artifact-defaults",
      order: corpusOrder,
      host_isolates: null,
      policy: regressionPolicy,
    },
    runtimes: ["baseline", "candidate"].map((label) => ({
      label,
      artifact_sha256: label === "baseline" ? "b".repeat(64) : "c".repeat(64),
      artifact_bytes: 1000,
      wasm_bytes: null,
      host_version: "native",
      startup_ms: null,
      limits,
    })),
    results: ["baseline", "candidate"].flatMap((runtime) =>
      extractionCorpus.flatMap((scenario) =>
        Array.from({ length: corpusProtocol.rounds }, (_, round) => ({
          runtime,
          scenario: scenario.name,
          round,
          cold_ms: round === 0 ? 2 : null,
          valid: 18,
          failures: 0,
          samples_ms: Array.from({ length: 15 }, () => 2),
          rss_kib: Array.from({ length: 15 }, () => 1000),
        })),
      ),
    ),
  };
}

test("complete paired reports use raw samples and declared protocol", () => {
  expect(evaluateBenchmark(report(), identity)).toEqual({
    accepted: true,
    kind: "comparison",
    issues: [],
    compared_rounds: extractionCorpus.length * 3,
  });
  const input = report();
  input.runtimes = input.runtimes.map((runtime) => ({ ...runtime, artifact_sha256: identity }));
  expect(evaluateBenchmark(input, identity).kind).toBe("calibration");
});
test("missing baseline, missing rows and duplicates cannot pass", () => {
  const input = report();
  expect(
    evaluateBenchmark({ ...input, runtimes: input.runtimes.slice(1) }, identity).issues,
  ).toContain("runtime-pair");
  expect(
    evaluateBenchmark({ ...input, results: input.results.slice(1) }, identity).issues,
  ).toContain("missing-row");
  expect(
    evaluateBenchmark(
      { ...input, results: [...input.results, ...input.results.slice(0, 1)] },
      identity,
    ).issues,
  ).toContain("duplicate-row");
});
test("budget, corpus, sample and warmup equivalence are mandatory", () => {
  const input = report();
  expect(evaluateBenchmark({ ...input, corpus_sha256: "d".repeat(64) }, identity).issues).toContain(
    "corpus-identity",
  );
  expect(
    evaluateBenchmark(
      {
        ...input,
        runtimes: input.runtimes.map((runtime) =>
          runtime.label === "candidate"
            ? { ...runtime, limits: { ...limits, max_dom_operations: 100000 } }
            : runtime,
        ),
      },
      identity,
    ).issues,
  ).toContain("budget-equivalence");
  expect(
    evaluateBenchmark(
      { ...input, results: input.results.map((row) => ({ ...row, rss_kib: [] })) },
      identity,
    ).issues,
  ).toContain("sample-completeness");
  expect(
    evaluateBenchmark(
      { ...input, results: input.results.map((row) => ({ ...row, valid: 15 })) },
      identity,
    ).issues,
  ).toContain("extraction-correctness");
  expect(
    evaluateBenchmark({ ...input, protocol: { ...input.protocol, samples: 1 } }, identity).issues,
  ).toContain("protocol");
});
test("invalid data and changed policies are rejected without echoing input", () => {
  const input = report();
  expect(evaluateBenchmark({ ...input, schema_version: 1 }, identity).issues).toEqual([
    "report-schema",
  ]);
  expect(
    evaluateBenchmark({ ...input, protocol: { ...input.protocol, policy: {} } }, identity).issues,
  ).toContain("regression-policy");
  expect(
    evaluateBenchmark(
      { ...input, results: input.results.map((row) => ({ ...row, samples_ms: [Number.NaN] })) },
      identity,
    ).issues,
  ).toEqual(["report-schema"]);
  expect(
    evaluateBenchmark({ ...input, environment: { ...input.environment, cpu: "unknown" } }, identity)
      .issues,
  ).toContain("environment");
});
test("serialized summaries and flags cannot conceal actual regressions", () => {
  const input = report();
  const result = evaluateBenchmark(
    {
      ...input,
      comparisons: [],
      results: input.results.map((row) =>
        row.runtime === "candidate"
          ? Object.assign({}, row, {
              samples_ms: row.samples_ms.map(() => 20),
              rss_kib: row.rss_kib.map(() => 200000),
              statistics: { p95_ms: 1 },
            })
          : row,
      ),
    },
    identity,
  );
  expect(result.accepted).toBe(false);
  expect(result.issues.some((issue) => issue.endsWith(":p95_ms"))).toBe(true);
  expect(result.issues.some((issue) => issue.endsWith(":max_rss_kib"))).toBe(true);
});
