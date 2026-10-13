# Extraction corpus v1

`tooling/extraction-corpus.ts` defines 13 synthetic extraction workloads shared by
native and Worker measurements: small pages, repeated selectors, asynchronous
fetch, event-driven DOM updates, modules, 5,000-node documents, repeated style
and class assignments, selector-heavy layout and paragraph wrapping. Every
extraction has an expected primitive result. Changing a fixture, expression,
expected result or budget requires a corpus version bump.

The normal test suite runs the corpus through real local HTTP and Worker/Wasm in
workerd at the original default limits. Benchmark runs use the same fixtures
and default limits on both hosts. Verify that a saved baseline has the same
default budgets before interpreting A/B results; the runner cannot attest the
defaults embedded in arbitrary historical binaries. Builds are prepared before
measurement:

```sh
cargo build --release --locked -p nimbo-engine
bun run build:worker
bun run bench:corpus:native > target/corpus-native.json
bun run bench:corpus:worker > target/corpus-worker.json
```

Optional A/B comparisons take a candidate artifact and a saved baseline:

```sh
bun run bench:corpus:native target/release/nimbo-engine target/benchmark-baseline/nimbo-engine > target/corpus-native-ab.json
bun run bench:corpus:worker dist/worker target/benchmark-baseline/worker > target/corpus-worker-ab.json
```

Do not benchmark while building or running other test suites. The runner makes
three rounds per workload, each with three warmups and 15 measured extractions,
at concurrency one. A/B requests alternate builds and reverse their first build
each iteration and round. Every attempted extraction, including warmups, must
return the expected result. Failures remain in the report and cause exit 1.
Native benchmark subprocesses clear the operational proxy environment variable;
the Worker uses only its isolated local fixture transport.

Reports include the corpus version/hash, raw samples, nearest-rank p50/p95,
min/max noise range, sequential throughput, artifact hashes/bytes, Wasm bytes,
OS/kernel/CPU/RAM, Bun and configured Rust versions, host runtime version and
load averages before/after the run. Worker artifact hashes cover both Wasm and
JavaScript. Reports omit paths, local endpoints, tokens, extracted contents and
child error output. The first extraction per scenario is recorded separately. Native starts a fresh
process for every extraction; only the first Worker scenario starts a cold host.
Worker startup includes local host
preparation and health readiness, not a production cold-start measurement.

Native times include process creation, navigation, extraction, output and exit.
Native peak RSS comes from Bun subprocess resource usage, including subprocess
startup and any driver memory inherited before exec. It is not an isolated
engine allocation measurement. Native artifact hashing streams bytes to avoid
retaining whole binaries in the driver. Worker times include the HTTP API round
trip and consumed response.
Linux process-tree RSS is sampled after each measured Worker request, outside
the timing window; it includes the local host and is neither page heap nor peak
Wasm allocation. Raw chronological RSS samples expose retention across repeated
extractions. Missing/incomplete process trees stay unknown.

## Regression policy

Version 1 declares these provisional local tolerances before A/B measurements:

| Metric              | Relative increase | Absolute headroom |
| ------------------- | ----------------: | ----------------: |
| p50 latency         |               15% |              5 ms |
| p95 latency         |               20% |              5 ms |
| Maximum sampled RSS |               20% |            16 MiB |

A round fails when an increase exceeds the larger of its relative tolerance and
absolute headroom. A/B runs exit 1 for any round's regression or incomplete RSS
samples. Quantile/regression tests independently cover tail selection, invalid
samples, throughput and both thresholds. Use this timing gate on an idle,
controlled runner. Shared CI gates correctness at default limits; it does not
gate wall-clock time. Local reports alone do not establish production throughput
or prove the 0.2 milestone complete. Profiling, controlled-runner ownership,
Worker peak allocation and sustained-load evidence remain open.

## Local A/B evidence, 2026-10-12

The baseline artifacts were built from the starting `d465632` revision before
the readiness changes; both revisions use the unchanged default engine budgets.
The final artifacts passed the complete local check suite. Four runs preserved
all 5,184 extraction results and collected every measured RSS sample:

| Host   | Original A/B report                          | Reversed A/B report                                   | Flagged rounds, original / reversed |
| ------ | -------------------------------------------- | ----------------------------------------------------- | ----------------------------------: |
| Native | [samples](performance-corpus-v1-native.json) | [samples](performance-corpus-v1-native-reversed.json) |                               2 / 2 |
| Worker | [samples](performance-corpus-v1-worker.json) | [samples](performance-corpus-v1-worker-reversed.json) |                               5 / 4 |

Original runs label the starting revision `baseline` and the readiness revision
`candidate`. Reversed runs swap those labels; artifact hashes identify the build
in every report. Every run exited 1 for its latency flags. No RSS comparison
crossed the declared threshold. Native alerts were confined to p95; Worker
alerts included p50 and p95. Alerts also occurred when the old revision was the
candidate. This indicates local timing variability, rather than establishing a
stable attribution to the readiness change. Keep all flags and raw samples;
these results do not pass the performance release gate. A controlled runner and
profiling are needed before claiming a performance improvement or regression.
