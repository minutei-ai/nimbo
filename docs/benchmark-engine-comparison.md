# Comparing Nimbo engine builds in celld

Use this comparison to isolate an engine change from the different control
transports in the [three-runtime benchmark](benchmark-comparison.md). Both builds
run inside separately owned celld hosts through the same authenticated HTTP API.
The runner uses the same real HTTP and JavaScript workloads as the three-runtime
comparison (currently nine scenarios), default limits,
fresh pages, alternating order, three excluded warmups and 21 measured attempts.

## Run it

Retain a baseline Worker bundle before changing or rebuilding the engine. Set
`NIMBO_BENCH_BASELINE_BUNDLE` privately to that bundle directory, then run:

```sh
bun run bench:engine-compare
```

The baseline directory must contain the complete prebuilt Worker bundle, including
`nimbo_engine_bg.wasm`. The candidate is rebuilt from the current source. Select
celld through `CELLD_BINARY` when necessary. Reports include both Wasm hashes,
validated values, failures, p50/p95 and fixture request counts; the runner now also
retains measured latency samples in execution order. Executable paths, tokens and
fixture URLs are excluded. Both hosts and their temporary directories are cleaned
up on completion.

The recorded comparisons below used the original eight scenarios. The new
positioned-box geometry workload requires a baseline that implements that contract;
older engines may report capability failures, which must remain in the report.

## Recorded bootstrap optimization

Whitespace-only minification reduces the per-page QuickJS bootstrap from 146262
to 111810 bytes (23.6%). Identifiers and constructor names are preserved. No heap,
DOM, HTTP or deadline limits change, and each page still has its own context.

The [first round](performance-engine-ab-bootstrap.json) and
[repeat](performance-engine-ab-bootstrap-repeat.json) each validate 384 extractions
with zero failures and 336 measured samples. Historical reports contain aggregate
timings; individual samples were not retained in those rounds. Both rounds are
published, including regressions. A [third run](performance-engine-ab-bootstrap-samples.json)
validates the updated report format: 384 valid extractions, zero failures and all
336 individual measured samples retained. Each cell below is baseline → candidate p50.

| Scenario               | First round      | Repeat           | Third run        |
| ---------------------- | ---------------- | ---------------- | ---------------- |
| `static`               | 40.60 → 49.30 ms | 50.20 → 41.23 ms | 46.35 → 49.41 ms |
| `selectors-200`        | 51.44 → 39.11 ms | 49.08 → 45.89 ms | 49.15 → 46.02 ms |
| `dynamic-fetch`        | 51.21 → 47.87 ms | 51.99 → 47.53 ms | 47.47 → 44.63 ms |
| `js-dom-events`        | 58.28 → 55.27 ms | 59.59 → 56.54 ms | 58.42 → 58.58 ms |
| `js-modules`           | 63.99 → 63.25 ms | 63.09 → 58.86 ms | 61.84 → 53.21 ms |
| `js-dom-selectors-200` | 62.78 → 60.60 ms | 61.98 → 59.02 ms | 38.09 → 41.69 ms |
| `static-5000`          | 70.01 → 68.06 ms | 70.61 → 58.47 ms | 58.08 → 68.08 ms |
| `selectors-200-5000`   | 62.94 → 55.41 ms | 68.95 → 69.58 ms | 55.39 → 70.79 ms |

Dynamic fetch and modules have lower candidate p50 in all three rounds. DOM
events and JavaScript selectors improve in the first two rounds but regress in
the third; static and large-page timings also vary. The third run has higher
candidate p50 in five of eight scenarios. p95 is mixed. The byte reduction is
established; a consistent overall latency improvement is not. These observations
do not establish statistical significance or universal speed improvement. The
full validation suite passed 4676 Bun tests and 89 native Rust tests in debug and
release with the minified bootstrap.

The [custom-boxes comparison](performance-engine-ab-custom-boxes.json) rebuilds
the earlier large-DOM engine and alternates it against the custom-boxes engine.
The reconstructed baseline Wasm hash matches the original recorded artifact.
All 384 extractions pass; six scenarios have lower candidate p50 and two have
slightly higher p50. The general slowdown seen in separate historical sessions
was not reproduced here. Its cause remains unproven.

These are local synthetic extraction measurements, not production throughput,
arbitrary website compatibility or evidence that every browser feature passes.
See the [coverage inventory](browser-coverage.md) for remaining capability gaps.
