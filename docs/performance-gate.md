# Artifact-attested performance gate

Benchmark report schema 2 records default page budgets obtained from each
artifact. The native CLI provides `--limits` without navigating; the Worker
health response exposes the same Rust defaults. Old artifacts unable to attest
these budgets fail before measurement. No historical report is silently upgraded.
The extraction corpus and its original budgets remain unchanged.

`bun run bench:gate report.json` validates the current corpus identity, both
runtime identities, identical page budgets and host versions, fixed protocol
and regression tolerances, every workload/round pair and complete raw latency/RSS
samples. Warmups must also have returned correct results. Missing, duplicate or
unexpected rows, unknown memory and changed thresholds reject the report.
Quantiles and regressions are recomputed from raw samples; serialized summaries
or empty alert arrays cannot hide a regression. Validation errors do not echo
report contents.

Matching artifact hashes are labeled calibration, not an optimization comparison.
A successful calibration verifies measurement completeness and provides a noise
control. It cannot establish that a code change improved performance. Candidate
and baseline must be measured on the same host with the same driver, after all
builds and unrelated tests finish.

The Worker driver can use the existing celld adapter with one stateless isolate,
or the pinned project-local Miniflare/workerd adapter:

```sh
NIMBO_BENCH_WORKER_HOST=workerd bun run bench:corpus:worker dist/worker dist/worker > target/worker-calibration.json
bun run bench:gate target/worker-calibration.json
```

The workerd adapter owns a separate child process and one Worker instance per
artifact. It forwards real HTTP requests into the built Nimbo Worker, samples
that host's process tree and disposes the host when finished. No third-party
browser executes Nimbo capabilities. Native and Worker measurements remain
separate; host RSS includes the host runtime and is not peak Wasm/page allocation.

The manual [performance workflow](../.github/workflows/performance.yml) accepts
full immutable commit SHAs, prepares baseline/candidate artifacts with pinned
Bun/Rust/wasm-bindgen, then measures each host serially on its job VM. It keeps
native and Worker jobs separate, forces one Worker instance/isolate, verifies
reports and archives raw data, gate results and source revisions even on failure.
It uses ephemeral GitHub-hosted VMs, read-only repository permissions and no
persistent checkout credentials. It has no automatic untrusted PR trigger.

Both commits must support schema 2 limit attestation. The first schema 2 build
is a baseline bootstrap; prior reports retain their original meaning. Dispatch
requires the workflow to be available to GitHub Actions. This repository change
alone is not evidence that the remote workflow ran or passed.

Shared hosted infrastructure can introduce timing noise even within a dedicated
job. The workflow does not prove controlled-runner ownership, production cold
starts or capacity. Keep calibration data, flags and hardware/runtime metadata;
do not tune thresholds to erase an observed failure. Controlled repeated A/B
acceptance, phase profiling and Worker transient/peak allocation evidence remain
required by the 0.2 milestone.

## Local calibration evidence

Native and pinned Miniflare/workerd A/A runs each preserved all 1,404 extraction
results and recorded every measured memory sample. The gate recognized both as
calibration and independently recomputed their alerts. The [native report](evidence/performance-gate-native-calibration.json)
flagged five p95 rounds; the [Worker report](evidence/performance-gate-worker-calibration.json)
flagged one p95 round. Neither flagged sampled RSS. Both commands and gates
returned failure for these alerts, as required by the existing policy. These
same-artifact differences demonstrate local timing variability; they do not
approve an optimization or close the performance milestone.

Full local validation passed 8,167 Bun tests and 223 native tests in each
debug/release profile, plus formatting, strict TypeScript/Rust/Wasm lint and Rust
documentation. The workflow passed actionlint 1.7.7. These checks validate the
implementation; they do not override the failed A/A timing gates or constitute
a remote workflow result.
