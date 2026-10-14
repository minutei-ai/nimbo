import { Schema } from "effect";
import { isDeepStrictEqual } from "node:util";
import { corpusIdentity } from "./benchmark-corpus";
import { Budget, corpusOrder, corpusProtocol } from "./benchmark-protocol";
import { regressionPolicy, regressions } from "./benchmark-statistics";
import { corpusVersion, extractionCorpus } from "./extraction-corpus";

const Natural = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Int.check(Schema.isGreaterThan(0));
const Sample = Schema.Finite.check(Schema.isGreaterThan(0));
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Report = Schema.Struct({
  schema_version: Schema.Literal(2),
  corpus_version: Positive,
  corpus_sha256: Hash,
  host: Schema.Literals(["native", "worker"]),
  environment: Schema.Struct({
    os: Schema.String,
    kernel: Schema.String,
    architecture: Schema.String,
    cpu: Schema.String,
    logical_cpus: Positive,
    ram_bytes: Sample,
    bun: Schema.String,
    configured_rust_toolchain: Schema.String,
    load_average_before: Schema.Array(Schema.Finite),
    load_average_after: Schema.Array(Schema.Finite),
  }),
  protocol: Schema.Struct({
    warmups: Natural,
    samples: Positive,
    rounds: Positive,
    concurrency: Positive,
    budget_mode: Schema.Literal("artifact-defaults"),
    order: Schema.Literal(corpusOrder),
    host_isolates: Schema.NullOr(Positive),
    policy: Schema.Unknown,
  }),
  runtimes: Schema.Array(
    Schema.Struct({
      label: Schema.Literals(["baseline", "candidate"]),
      artifact_sha256: Hash,
      artifact_bytes: Positive,
      wasm_bytes: Schema.NullOr(Positive),
      host_version: Schema.String,
      startup_ms: Schema.NullOr(Sample),
      limits: Budget,
    }),
  ),
  results: Schema.Array(
    Schema.Struct({
      runtime: Schema.Literals(["baseline", "candidate"]),
      scenario: Schema.String,
      round: Natural,
      cold_ms: Schema.NullOr(Sample),
      valid: Natural,
      failures: Natural,
      samples_ms: Schema.Array(Sample),
      rss_kib: Schema.Array(Sample),
    }),
  ),
});

export function evaluateBenchmark(input: unknown, identity: string) {
  let report: typeof Report.Type;
  try {
    report = Schema.decodeUnknownSync(Report)(input);
  } catch {
    return { accepted: false, kind: "invalid", issues: ["report-schema"], compared_rounds: 0 };
  }
  const issues = new Set<string>();
  if (report.corpus_version !== corpusVersion || report.corpus_sha256 !== identity)
    issues.add("corpus-identity");
  for (const [key, value] of Object.entries(corpusProtocol)) {
    if (Reflect.get(report.protocol, key) !== value) issues.add("protocol");
  }
  if (!isDeepStrictEqual(report.protocol.policy, regressionPolicy)) issues.add("regression-policy");
  if (report.protocol.host_isolates !== (report.host === "worker" ? 1 : null))
    issues.add("host-isolates");
  for (const value of [
    report.environment.os,
    report.environment.kernel,
    report.environment.architecture,
    report.environment.cpu,
    report.environment.bun,
    report.environment.configured_rust_toolchain,
  ]) {
    if (!value.trim() || value === "unknown") issues.add("environment");
  }
  for (const values of [
    report.environment.load_average_before,
    report.environment.load_average_after,
  ]) {
    if (values.length !== 3 || values.some((value) => value < 0)) issues.add("environment-load");
  }
  const baseline = report.runtimes.find((runtime) => runtime.label === "baseline");
  const candidate = report.runtimes.find((runtime) => runtime.label === "candidate");
  if (report.runtimes.length !== 2 || !baseline || !candidate) issues.add("runtime-pair");
  if (baseline && candidate) {
    if (!isDeepStrictEqual(baseline.limits, candidate.limits)) issues.add("budget-equivalence");
    if (baseline.host_version !== candidate.host_version) issues.add("host-version");
  }
  for (const runtime of report.runtimes) {
    if (!runtime.host_version.trim()) issues.add("host-version");
    if (
      report.host === "worker"
        ? runtime.wasm_bytes === null ||
          runtime.startup_ms === null ||
          runtime.wasm_bytes > runtime.artifact_bytes
        : runtime.wasm_bytes !== null || runtime.startup_ms !== null
    )
      issues.add("runtime-metadata");
  }
  const names = new Set<string>(extractionCorpus.map((scenario) => scenario.name));
  const rows = new Map<string, (typeof report.results)[number]>();
  for (const row of report.results) {
    if (!names.has(row.scenario) || row.round >= corpusProtocol.rounds) {
      issues.add("unexpected-row");
      continue;
    }
    const key = `${row.runtime}:${row.scenario}:${row.round}`;
    if (rows.has(key)) issues.add("duplicate-row");
    rows.set(key, row);
    if (row.valid !== corpusProtocol.warmups + corpusProtocol.samples || row.failures !== 0)
      issues.add("extraction-correctness");
    if (
      row.samples_ms.length !== corpusProtocol.samples ||
      row.rss_kib.length !== corpusProtocol.samples
    )
      issues.add("sample-completeness");
    if (row.round === 0 ? row.cold_ms === null : row.cold_ms !== null) issues.add("cold-sample");
  }
  let compared = 0;
  for (const name of names) {
    for (let round = 0; round < corpusProtocol.rounds; round++) {
      const before = rows.get(`baseline:${name}:${round}`),
        after = rows.get(`candidate:${name}:${round}`);
      if (!before || !after) {
        issues.add("missing-row");
        continue;
      }
      if (
        before.samples_ms.length !== corpusProtocol.samples ||
        after.samples_ms.length !== corpusProtocol.samples ||
        before.rss_kib.length !== corpusProtocol.samples ||
        after.rss_kib.length !== corpusProtocol.samples
      )
        continue;
      compared++;
      for (const metric of regressions(before, after))
        issues.add(`${name}:round-${round}:${metric}`);
    }
  }
  return {
    accepted: issues.size === 0,
    kind:
      !baseline || !candidate
        ? "invalid"
        : baseline.artifact_sha256 === candidate.artifact_sha256
          ? "calibration"
          : "comparison",
    issues: [...issues],
    compared_rounds: compared,
  };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: benchmark-gate.ts report.json");
  let result: ReturnType<typeof evaluateBenchmark>;
  try {
    const input: unknown = await Bun.file(path).json();
    result = evaluateBenchmark(input, await corpusIdentity());
  } catch {
    result = { accepted: false, kind: "invalid", issues: ["report-json"], compared_rounds: 0 };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.accepted) process.exitCode = 1;
}
