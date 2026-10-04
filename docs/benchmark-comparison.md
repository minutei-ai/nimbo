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

See [the recorded comparison](performance-comparison.json), including rejected
large-page workloads. Default limits remain enabled. Capability failures matter
alongside latency; a runtime with rejected extractions cannot claim parity on
those workloads.

## Recorded result

The isolated local run on 2026-10-04 used celld 0.6.1, the public Obscura 0.2.3
Linux release and Chrome for Testing 153.0.8010.12. Obscura advertises a Chrome
identity through CDP; the report identifies its actual release separately.
All six common scenarios passed 24 attempts per runtime. Both 5000-row scenarios
passed in Obscura and Chromium but failed all 24 attempts each in Nimbo with
HTTP 422 under its default DOM operation budget. Total: 576 attempts, 528 valid
extractions and 48 rejected extractions; 462 successful measured samples.

| JavaScript scenario                | Nimbo in celld p50 | Obscura p50 | Chromium p50 |
| ---------------------------------- | ------------------ | ----------- | ------------ |
| DOM, POST, timer and event         | 38.21 ms           | 29.17 ms    | 56.76 ms     |
| External modules and generated DOM | 42.14 ms           | 29.18 ms    | 62.22 ms     |
| 200 selectors over generated DOM   | 39.47 ms           | 29.50 ms    | 59.13 ms     |

These values describe this synthetic suite and the documented control adapters.
They are not a general browser-speed or capability ranking. The larger-page
rejections remain a concrete Nimbo gap to address; they are retained in the
report alongside successful JavaScript workloads.
