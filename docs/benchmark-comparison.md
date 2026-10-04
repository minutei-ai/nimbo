# Nimbo in celld vs Obscura vs Chromium

The comparison runs Nimbo's own Wasm engine inside celld, a separate public
Obscura release in CDP server mode, and an unmodified headless Chromium binary.
Obscura is only a comparator. It never serves Nimbo requests.

## Run it

Build prerequisites are listed in the [README](../README.md). Install celld,
a [public Obscura release](https://github.com/h4ckf0r0day/obscura/releases), and
Chromium. Select their executables privately through `CELLD_BINARY`,
`NIMBO_COMPARE_OBSCURA_BINARY` and `NIMBO_COMPARE_CHROMIUM_BINARY` when they are
outside your executable search path. No executable paths are written to reports.

```sh
bun run bench:compare
```

The runner owns and cleans up all three processes, their temporary profiles and
the real HTTP fixture. Obscura's loopback access is explicitly enabled for this
synthetic fixture. Chromium runs headless without stealth patches or extensions.
The included `--no-sandbox` launch option supports isolated benchmark hosts where
Chromium's OS sandbox cannot initialize; choose your host isolation accordingly.

## Workloads and measurement

The same URLs and JavaScript extraction expressions run in all three engines.
The current suite has nine scenarios; the historical reports below have the
original eight:

| Scenario               | Real work performed                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `static`               | Select text from 16 server-rendered rows                                                                       |
| `selectors-200`        | Run 200 selectors against those rows                                                                           |
| `dynamic-fetch`        | Execute page JavaScript, fetch JSON and change the title                                                       |
| `js-dom-events`        | POST for data, wait on a real timer, construct DOM nodes, dispatch an event and extract generated text         |
| `js-modules`           | Load an external ES module, POST for data, wait on a timer, construct the DOM and count generated nodes        |
| `js-dom-selectors-200` | Execute the JavaScript application and run 200 selectors against its generated DOM                             |
| `static-5000`          | Select text from 5000 rows under default engine limits                                                         |
| `selectors-200-5000`   | Run 200 selectors against 5000 rows under default engine limits                                                |
| `js-positioned-boxes`  | Execute 25 numeric/DOM assertions for absolute/fixed box geometry, mutations and viewport-relative coordinates |

Runtime hosts remain running throughout the benchmark. Each extraction creates
a fresh page or target. Requests run sequentially with runtime order rotated on
each iteration, avoiding competition and fixed ordering bias. The fixture sends
`Cache-Control: no-store`; the report counts actual origin requests.

Each scenario has 24 attempts per runtime: three warmups and 21 measured attempts.
Every result is validated. Failures are counted separately and never converted
into successful timing samples. Promises wait for application work to complete;
there is no fixed post-load settle delay. JavaScript uses the engine being tested,
including Nimbo's own QuickJS inside celld.

Latency includes control transport, page creation, navigation, application work,
extraction and page cleanup. Nimbo uses its authenticated HTTP API; the other two
use CDP. These are end-to-end extraction timings, not identical-protocol CPU
measurements. No process cold-start, screenshots, rendering fidelity, distributed
throughput, memory stability or production cost is established by this suite.
The synthetic application is vanilla JavaScript; passing it does not establish
compatibility with every framework or website.

See [the recorded comparison](performance-comparison.json), its
[repeat](performance-comparison-repeat.json), the
[large-DOM optimization run](performance-comparison-large-dom.json) and the
[baseline](performance-comparison-baseline.json). Default limits remain enabled.
Capability failures matter alongside latency; rejected extractions never become
successful timing samples.

## Recorded result

The isolated local run on 2026-10-04 used celld 0.6.1, the public Obscura 0.2.3
Linux release and Chrome for Testing 153.0.8010.12. Obscura advertises a Chrome
identity through CDP; the report identifies its actual release separately.
The baseline contained 576 attempts, 528 valid extractions and 48 Nimbo HTTP 422
failures on the two 5000-row workloads. The optimized repeat has **576 valid
extractions, zero failures and 504 measured samples**. All eight scenarios pass
24 attempts in each runtime, including JavaScript and large-page workloads.

| Scenario               | Nimbo in celld p50 | Obscura p50 | Chromium p50 |
| ---------------------- | ------------------ | ----------- | ------------ |
| `static`               | 39.01 ms           | 19.10 ms    | 61.56 ms     |
| `selectors-200`        | 41.82 ms           | 19.68 ms    | 63.11 ms     |
| `dynamic-fetch`        | 38.80 ms           | 21.19 ms    | 63.67 ms     |
| `js-dom-events`        | 51.29 ms           | 29.91 ms    | 66.88 ms     |
| `js-modules`           | 58.22 ms           | 30.73 ms    | 68.14 ms     |
| `js-dom-selectors-200` | 44.79 ms           | 31.25 ms    | 64.74 ms     |
| `static-5000`          | 57.68 ms           | 44.82 ms    | 245.41 ms    |
| `selectors-200-5000`   | 66.63 ms           | 98.96 ms    | 261.91 ms    |

The change avoids full-tree external stylesheet discovery when no potential link
exists and materializes static NodeList wrappers only when accessed. Dynamically
created links still load through real HTTP; DOM operation and heap limits are
unchanged. The 5000-row failure is resolved for these fixtures, not by raising a
limit or dropping a workload.

The table is the first round after custom HTML boxes, contents flattening and
scripting-enabled noscript geometry were added. Its large-page selector p50 is
33% lower than Obscura and 75% lower than Chromium. Obscura remains faster on
the other seven scenarios. Both rounds pass all 576 attempts, giving 1152 valid
extractions and zero failures across the two rounds.

| Nimbo scenario         | Earlier large-DOM run p50 | Current first round p50 | Current repeat p50 |
| ---------------------- | ------------------------- | ----------------------- | ------------------ |
| `static`               | 31.06 ms                  | 39.01 ms                | 36.68 ms           |
| `selectors-200`        | 30.58 ms                  | 41.82 ms                | 44.19 ms           |
| `dynamic-fetch`        | 29.53 ms                  | 38.80 ms                | 40.69 ms           |
| `js-dom-events`        | 35.77 ms                  | 51.29 ms                | 57.26 ms           |
| `js-modules`           | 39.19 ms                  | 58.22 ms                | 51.00 ms           |
| `js-dom-selectors-200` | 39.69 ms                  | 44.79 ms                | 49.66 ms           |
| `static-5000`          | 46.76 ms                  | 57.68 ms                | 64.81 ms           |
| `selectors-200-5000`   | 46.25 ms                  | 66.63 ms                | 74.04 ms           |

Both current rounds are slower than the earlier Nimbo run. All reports retain
p95, failure counts and engine provenance. The cause is unresolved: these are
local measurements at different times, not an interleaved comparison of both
engine builds on the same host. Do not claim preserved performance or select the
faster current round as a universal ranking. Further profiling and controlled
comparisons are required.

Local validation passed 4676 Bun tests and 89 native Rust tests in debug and
release, plus formatting, native/Wasm Clippy and Rust documentation. Rust tests
used four threads and unchanged engine limits/deadlines. The 64 large-DOM
variants have 448 real Chromium reference checks; the custom/contents fixture
has 1536 matches and 128 measured differences over 64 variants. See the
[coverage inventory](browser-coverage.md) for their exact scope.

These values describe this synthetic suite and the documented control adapters.
They establish neither arbitrary website/framework compatibility nor production
Cloudflare deployment. Further scraping compatibility and performance work
remains necessary.

## Controlled engine comparisons

The [same-session build comparison](benchmark-engine-comparison.md) tests both
Nimbo builds inside celld with the same HTTP adapter. It retains the custom-boxes
comparison and all three whitespace-minification rounds, including slower measurements.
Those controlled results supplement the historical tables above; they do not
establish the cause of changes between separate sessions or universal superiority.

## Whitespace-minified bootstrap run

The [new three-runtime run](performance-comparison-bootstrap.json) retains all
eight scenarios and default limits: **576 valid extractions, zero failures and
504 measured samples**. Each cell below is an end-to-end p50, using the same
control adapters described above.

| Scenario               | Nimbo in celld | Obscura  | Chromium  |
| ---------------------- | -------------- | -------- | --------- |
| `static`               | 31.84 ms       | 18.55 ms | 58.49 ms  |
| `selectors-200`        | 38.79 ms       | 19.32 ms | 61.76 ms  |
| `dynamic-fetch`        | 34.55 ms       | 20.54 ms | 62.18 ms  |
| `js-dom-events`        | 38.27 ms       | 27.36 ms | 61.77 ms  |
| `js-modules`           | 53.97 ms       | 30.17 ms | 69.34 ms  |
| `js-dom-selectors-200` | 58.33 ms       | 30.30 ms | 64.63 ms  |
| `static-5000`          | 62.07 ms       | 41.95 ms | 254.21 ms |
| `selectors-200-5000`   | 60.99 ms       | 96.57 ms | 270.74 ms |

Nimbo has lower p50 than Chromium in all eight workloads and lower p50 than
Obscura in the large-page selector workload only. Obscura remains faster in the
other seven. This run is separate from the three controlled bootstrap comparisons;
use those comparisons to assess the build change with a matching transport.
No universal speed or scraping compatibility claim follows from these results.

## Nine-scenario positioning run

The [positioning comparison](performance-comparison-positioned-boxes.json) on
2026-10-04 includes all eight previous workloads and the new 25-assertion
positioning workload. It records **648 valid extractions, zero failures and
567 measured samples**, with unchanged default limits and the same three runtime
versions. The local full gate passed 4743 Bun tests and 90 Rust tests in both
debug and release, plus formatting, type-aware lint, native/Wasm Clippy and docs.

| Scenario               | Nimbo in celld p50 | Obscura p50 | Chromium p50 |
| ---------------------- | ------------------ | ----------- | ------------ |
| `static`               | 32.37 ms           | 18.40 ms    | 60.01 ms     |
| `selectors-200`        | 37.89 ms           | 19.64 ms    | 64.63 ms     |
| `dynamic-fetch`        | 42.07 ms           | 20.85 ms    | 65.53 ms     |
| `js-dom-events`        | 45.07 ms           | 30.31 ms    | 68.95 ms     |
| `js-modules`           | 60.88 ms           | 31.55 ms    | 76.89 ms     |
| `js-dom-selectors-200` | 54.73 ms           | 31.31 ms    | 68.17 ms     |
| `static-5000`          | 64.72 ms           | 43.05 ms    | 269.80 ms    |
| `selectors-200-5000`   | 67.80 ms           | 97.82 ms    | 262.03 ms    |
| `js-positioned-boxes`  | 52.00 ms           | 34.43 ms    | 71.45 ms     |

Nimbo is faster than Chromium on all nine workload medians in this run, and
faster than Obscura on the large-DOM repeated-selector workload. Obscura remains
faster on the other eight. This does not establish universal superiority or
a complete browser capability pass. The [upstream suite baseline](benchmark-reference-matrix.md)
exposes failures on original framework and API fixtures that these nine
synthetic workloads do not cover.

## Native namespace and iframe-interface repeat

The [current three-runtime repeat](performance-comparison-namespaces.json) retains
all nine existing scenarios, three validated excluded warmups and 21 measured
attempts per runtime/scenario. All **648 attempts passed**, with **567 measured
samples** and no failures. This is a performance control over those nine public
synthetic scenarios; the separate [original obstacle repeat](performance-obstacle-namespaces.json)
records the unchanged upstream fixtures and assertions, including the newly
passing React and Preact stages. Neither result establishes all-suite parity.

| Scenario               | Nimbo in celld p50 | Obscura p50 | Chromium p50 |
| ---------------------- | ------------------ | ----------- | ------------ |
| `static`               | 28.42 ms           | 19.05 ms    | 71.22 ms     |
| `selectors-200`        | 31.42 ms           | 20.19 ms    | 68.14 ms     |
| `dynamic-fetch`        | 29.09 ms           | 20.40 ms    | 65.72 ms     |
| `js-dom-events`        | 41.42 ms           | 28.68 ms    | 68.77 ms     |
| `js-modules`           | 45.02 ms           | 29.87 ms    | 63.65 ms     |
| `js-dom-selectors-200` | 43.89 ms           | 29.83 ms    | 74.09 ms     |
| `static-5000`          | 58.87 ms           | 42.36 ms    | 263.83 ms    |
| `selectors-200-5000`   | 57.49 ms           | 100.56 ms   | 248.95 ms    |
| `js-positioned-boxes`  | 53.50 ms           | 33.15 ms    | 63.03 ms     |

Nimbo has the lower median than Chromium in all nine scenarios and than Obscura
in one scenario, the 5000-row/200-selector workload. Obscura remains faster in
eight scenarios. These are host/transport-inclusive elapsed timings from one
sequential run with rotating runtime order; the existing cold-process, TLS,
resource-isolation and workload-coverage limitations still apply. The original
obstacle suite uses its own required three-second settle delay and is not an
identical performance methodology.

## Shared Rust response-decoding repeat

The [response-decoding comparison](performance-comparison-response-encoding.json)
retains all nine control scenarios, three validated excluded warmups and 21
measured attempts per runtime/scenario. All **648 attempts passed**, producing
**567 measured samples**, with no failures. The separate [corrected upstream
obstacle run](performance-obstacle-response-encoding.json) verifies original
assertions and the new Shift_JIS pass. The nine performance controls do not
substitute for the upstream suites.

| Scenario               | Nimbo in celld p50 | Obscura p50 | Chromium p50 |
| ---------------------- | ------------------ | ----------- | ------------ |
| `static`               | 35.43 ms           | 18.39 ms    | 57.31 ms     |
| `selectors-200`        | 42.24 ms           | 19.05 ms    | 61.24 ms     |
| `dynamic-fetch`        | 43.93 ms           | 34.98 ms    | 107.18 ms    |
| `js-dom-events`        | 57.02 ms           | 47.11 ms    | 99.10 ms     |
| `js-modules`           | 53.26 ms           | 38.32 ms    | 93.67 ms     |
| `js-dom-selectors-200` | 43.28 ms           | 32.61 ms    | 71.75 ms     |
| `static-5000`          | 50.30 ms           | 45.59 ms    | 276.23 ms    |
| `selectors-200-5000`   | 44.82 ms           | 90.04 ms    | 227.28 ms    |
| `js-positioned-boxes`  | 41.74 ms           | 30.32 ms    | 61.87 ms     |

Nimbo's median is lower than Chromium's in all nine scenarios and than Obscura's
in one, the 5000-row/200-selector workload. Obscura remains faster in eight.
The report retains the higher p95 samples, including dynamic-fetch variability;
no outliers or failed assertions were removed. This is one sequential elapsed-time
run with rotating runtime order and host/transport costs. It is not a controlled
baseline/candidate A/B experiment or proof of universal speed improvement.
The existing cold-process, resource-isolation, TLS and coverage limitations remain.

## Native URL bindings repeat

The [current URL-bindings report](performance-comparison-url.json) records
**648 valid real HTTP extractions, zero failures and 567 measured samples**.
All nine scenarios use the same own Nimbo Worker/Wasm bundle inside celld,
public Obscura and unmodified Chromium, with three excluded warmups, 21 measured
attempts, rotating runtime order and fresh extraction pages. Tests and builds
were finished before these measurements.

| Scenario               | Nimbo/celld p50 | Obscura p50 | Chromium p50 |
| ---------------------- | --------------- | ----------- | ------------ |
| `static`               | 34.69 ms        | 18.16 ms    | 55.47 ms     |
| `selectors-200`        | 36.76 ms        | 19.80 ms    | 64.72 ms     |
| `dynamic-fetch`        | 33.81 ms        | 20.89 ms    | 63.23 ms     |
| `js-dom-events`        | 42.56 ms        | 30.92 ms    | 70.12 ms     |
| `js-modules`           | 50.26 ms        | 30.19 ms    | 69.48 ms     |
| `js-dom-selectors-200` | 51.24 ms        | 31.20 ms    | 66.16 ms     |
| `static-5000`          | 51.82 ms        | 41.47 ms    | 255.48 ms    |
| `selectors-200-5000`   | 63.86 ms        | 100.25 ms   | 262.16 ms    |
| `js-positioned-boxes`  | 53.92 ms        | 35.08 ms    | 77.88 ms     |

Nimbo's median is lower than Chromium in 9/9 scenarios and lower than Obscura
in 1/9. These end-to-end measurements include the documented HTTP/CDP control
adapters. No isolated A/B improvement, universal speed advantage or production
Cloudflare result is established. All previous reports and current p95 values
remain available; further performance work remains necessary.

Local validation passes 5001 Bun tests and 95 Rust tests in both debug and
release, plus formatting, Worker/Wasm builds, native/Wasm Clippy and Rust docs.
The [original URL WPT result](performance-wpt-url.json) separately records
3,820 passes out of 4,712 completed tests, 892 failures and one incomplete variant.
The [33-stage original obstacle repeat](performance-obstacle-url.json) records
13 passed stages, 16 failures and four missing output adapters. Passing local
regression checks does not replace those original-suite requirements.

## Worker proxy bundle measurement

The [current bundle run](performance-comparison-worker-proxy.json), recorded on
2026-10-04 after adding direct Worker proxy transport, has 648 valid extractions,
zero failures and 567 measured samples across the nine scenarios. This measures
the normal direct-fetch path without a configured proxy, inside celld 0.6.1,
against public Obscura 0.2.3 and Chrome for Testing 153.0.8010.12. All hosts stay
running; pages are fresh and runtime order rotates at concurrency one.

Nimbo has a lower p50 than Chromium in eight of nine scenarios and Obscura in
one of nine. Its positioned-box p50 is 73.51 ms versus Chromium's 70.01 ms;
the other Nimbo p50 values range from 43.74 to 70.04 ms. Several Nimbo timings
are higher than the earlier sticky run. Separate local runs do not isolate the
cause; a controlled same-adapter build comparison is needed before attributing
that difference to the transport implementation. These measurements do not
establish proxy latency or deployed Cloudflare performance.
