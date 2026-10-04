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

The same URLs and JavaScript extraction expressions run in all three engines:

| Scenario               | Real work performed                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `static`               | Select text from 16 server-rendered rows                                                                |
| `selectors-200`        | Run 200 selectors against those rows                                                                    |
| `dynamic-fetch`        | Execute page JavaScript, fetch JSON and change the title                                                |
| `js-dom-events`        | POST for data, wait on a real timer, construct DOM nodes, dispatch an event and extract generated text  |
| `js-modules`           | Load an external ES module, POST for data, wait on a timer, construct the DOM and count generated nodes |
| `js-dom-selectors-200` | Execute the JavaScript application and run 200 selectors against its generated DOM                      |
| `static-5000`          | Select text from 5000 rows under default engine limits                                                  |
| `selectors-200-5000`   | Run 200 selectors against 5000 rows under default engine limits                                         |

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

See [the recorded comparison](performance-comparison.json) and the preserved
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
| `static`               | 31.06 ms           | 16.93 ms    | 53.67 ms     |
| `selectors-200`        | 30.58 ms           | 18.06 ms    | 59.43 ms     |
| `dynamic-fetch`        | 29.53 ms           | 20.71 ms    | 61.23 ms     |
| `js-dom-events`        | 35.77 ms           | 29.13 ms    | 57.48 ms     |
| `js-modules`           | 39.19 ms           | 28.42 ms    | 65.03 ms     |
| `js-dom-selectors-200` | 39.69 ms           | 29.46 ms    | 61.30 ms     |
| `static-5000`          | 46.76 ms           | 40.31 ms    | 233.61 ms    |
| `selectors-200-5000`   | 46.25 ms           | 86.85 ms    | 247.30 ms    |

The change avoids full-tree external stylesheet discovery when no potential link
exists and materializes static NodeList wrappers only when accessed. Dynamically
created links still load through real HTTP; DOM operation and heap limits are
unchanged. The 5000-row failure is resolved for these fixtures, not by raising a
limit or dropping a workload.

The repeated-selector large-page case has 1.88 times lower p50 latency than
Obscura and 5.35 times lower than Chromium in this run. Obscura remains faster on
the other seven scenarios. Nimbo's common-workload p50 changes are mixed: some
improve, others stay close or regress. Both reports retain p95, failure counts
and provenance. A single local repeat does not establish statistical significance
or a universal speed ranking.

Local validation passed 4611 Bun tests and 88 native Rust tests in debug and
release, plus formatting, native/Wasm Clippy and Rust documentation. The first
parallel debug run failed an 80 ms deadline test during JavaScript initialization;
the complete debug suite passed with one test thread and the same deadline.
The 64 large-DOM variants also have 448 real Chromium reference checks.

These values describe this synthetic suite and the documented control adapters.
They establish neither arbitrary website/framework compatibility nor production
Cloudflare deployment. Further scraping compatibility and performance work
remains necessary.
