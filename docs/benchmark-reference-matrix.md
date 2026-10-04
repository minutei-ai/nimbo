# Upstream browser benchmark contracts

Reviewed on 2026-10-04. The target is to pass the original upstream suites,
including their original fixtures, scripts, assertions and success criteria.
An equivalent-looking Nimbo fixture does not count as passing an upstream test.
Missing APIs, runner support and output adapters remain visible obligations.
No mock browser objects, substituted framework pages, relaxed expected values,
successful skips or comparator backends are permitted.

Adapters may change launch and transport so that the same test code runs in
Nimbo's own engine. Record every adapter difference. An adapter must not alter
the page under test or its assertions. Preserve licenses when redistributing
upstream assets; this runner reads a separate public checkout without vendoring
an upstream engine or its framework assets.

## Sources and full-suite obligations

| Reference                                                                                                                                                                                                                                                | Original test surface                                                                                                              | Nimbo execution status                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Kitesurf official methodology](https://developers.cloudflare.com/browser-run/kitesurf/)                                                                                                                                                                 | WPT conformance and five Quick Action repetitions over the published 14-URL corpus; screenshot and HTML CPU, memory and wall time  | Not run in Nimbo; original corpus and full rendering adapter remain required |
| [Obscura benchmark](https://github.com/h4ckf0r0day/obscura-benchmark)                                                                                                                                                                                    | Seven tracks: WPT, obstacle course, comparison, real-world corpus, stealth, latency and reliability                                | Obstacle baseline executed below; remaining tracks pending                   |
| [Obscura obstacle manifest](https://github.com/h4ckf0r0day/obscura-benchmark/blob/2d7bc304fbb7ebefc44f770938192e3cede87dbd/obstacle-course/manifest.json)                                                                                                | All 33 stages, including original React, Preact and Vue assets                                                                     | 12 passed, 17 failed, 4 missing output adapters                              |
| [Obscura stealth runner](https://github.com/h4ckf0r0day/obscura-benchmark/blob/2d7bc304fbb7ebefc44f770938192e3cede87dbd/stealth-bench/run.py)                                                                                                            | Original fingerprint assertions, profiles and captured HTTP headers                                                                | Not run; fingerprint obstacle currently fails                                |
| [Obscura rendering regressions](https://github.com/h4ckf0r0day/obscura/tree/590f79e1a179a0157a50e7e21fbc568f1ab6b43f/render-repros)                                                                                                                      | Original rendering fixtures, capture scripts and expectations                                                                      | Not run; own numeric geometry evidence is supplementary                      |
| [CreepJS source](https://github.com/abrahamjuliot/creepjs/tree/10aa6724cd33a1015db1574211890518cd04f0cc) and [official live page](https://abrahamjuliot.github.io/creepjs/)                                                                              | Complete fingerprint collection and consistency checks, including reflection, engine, layout, canvas, fonts, audio and WebGL       | Not run; runner and several engine capabilities pending                      |
| [Sannysoft](https://bot.sannysoft.com/)                                                                                                                                                                                                                  | Original Intoli/additional fingerprint checks and scanner                                                                          | Not run; live source and loaded assets need a recorded snapshot              |
| [Rebrowser detector](https://github.com/rebrowser/rebrowser-bot-detector/tree/e1a25b1ff264cc9a5b5ea7fe8a6dfc26e3b1c718)                                                                                                                                  | Original runtime/source URL leaks, execution world, webdriver, CSP, viewport, user agent, init scripts and exposed bindings checks | Not run; automation adapter pending                                          |
| [BrowserScan](https://www.browserscan.net/)                                                                                                                                                                                                              | Original live browser consistency and automation checks                                                                            | Not run; record actual live verdicts and source version where available      |
| [BrowserLeaks](https://browserleaks.com/)                                                                                                                                                                                                                | Original browser/network checks, including TLS, WebRTC, canvas, fonts and WebGL                                                    | Not run; Worker fetch does not establish controllable TLS                    |
| [Puppeteer-extra stealth tests](https://github.com/berstend/puppeteer-extra/tree/39248f1f5deeb21b1e7eb6ae07b8ef73f1231ab9/packages/puppeteer-extra-plugin-stealth)                                                                                       | Original test files and assertions for each evasion                                                                                | Not run; launcher adapter needed, no plugin runtime in Nimbo                 |
| [Fortress gauntlet](https://github.com/tiliondev/fortress/blob/2922461be6e1ba96ede0afd521dbec228ff0c1a4/tools/gauntlet.py) and [site methodology](https://github.com/tiliondev/fortress/blob/2922461be6e1ba96ede0afd521dbec228ff0c1a4/docs/BENCHMARK.md) | Original checker assertions and real-page success criteria                                                                         | Not run; publisher results are not Nimbo evidence                            |
| [BrowserBench](https://www.browserbench.org/)                                                                                                                                                                                                            | Speedometer responsiveness, JetStream 3 JavaScript/Wasm and MotionMark graphics                                                    | Not run; performance suites do not replace scraping or stealth assertions    |

The public Obscura WPT configuration pins
`03f14d4780c4d981bc84c65679b18e9327a1affe` in the
[original WPT repository](https://github.com/web-platform-tests/wpt/tree/03f14d4780c4d981bc84c65679b18e9327a1affe).
That full-suite execution remains pending.

Source revisions are recorded in the [reference inventory](evidence/benchmark-reference-inventory.json).
The inventory pins repositories, not a complete count of their assertions.
Live detectors without an immutable public revision need a dated capture and
asset hashes; a changing live score alone is not a reproducible suite version.
Kitesurf's direct benchmark dashboard could not be fetched during this review.
Its official documentation describes five Quick Action repetitions across a
14-URL corpus and a warm Chromium pool, measuring CPU, memory and wall time for
HTML extraction and screenshots. Those publisher measurements are not Nimbo
results; the original corpus and screenshot tests remain required. Existing
[capability obligations](browser-coverage.md) remain in scope.

## Obscura obstacle baseline in celld

Clone the public benchmark into a separate checkout. Set
`NIMBO_BENCH_REFERENCE_ROOT` privately to that checkout and, if necessary,
`CELLD_BINARY` to the celld executable. The runner requires a clean checkout
at the recorded revision; neither filesystem paths nor API tokens enter reports.

```sh
git clone https://github.com/h4ckf0r0day/obscura-benchmark.git "$NIMBO_BENCH_REFERENCE_ROOT"
git -C "$NIMBO_BENCH_REFERENCE_ROOT" checkout 2d7bc304fbb7ebefc44f770938192e3cede87dbd
bun run bench:obstacle
```

`tooling/benchmark-obstacle.ts` serves the original fixture files, framework
assets, data and module graphs over real HTTP. It runs the manifest's original
`check` expression and compares its result with the original `expect` value,
without editing the checkout. All 33 stages remain in the report.

There are five measured attempts and one validated warmup per evaluation stage.
The default counts come from the original upstream manifest.
`NIMBO_OBSTACLE_RUNS` may select 1–100 measured attempts. Every attempt uses a
fresh Nimbo page in the same celld host under default engine limits. Failures
never enter successful timing samples, and any failed or unadapted stage makes
the command exit nonzero. Each row retains attempt counts, failure reasons,
successful raw timing samples and the last actual extraction value.

The fixture adapter now explicitly sends media types without a forced UTF-8
charset. The upstream runner uses Python SimpleHTTPRequestHandler, whereas
Bun.file otherwise adds charset=utf-8 to HTML. That incorrect header overrides
the original Shift_JIS meta declaration. All 42 HTML/JavaScript/JSON asset media
types were checked against Python's MIME mapping, with no differences. Pages,
asset bytes, expressions, expectations, delays and limits are unchanged. This
corrects test transport rather than adding an expected-value override.

The original baseline and namespace repeat retained below used Bun's implicit
charset. They remain historical evidence with that transport limitation. The
[decoding transport diagnostic](performance-obstacle-response-encoding-transport-diagnostic.json)
records the new engine under that earlier adapter: 11 passed, 18 failed and four
unadapted. It is not the corrected upstream transport run.

The runner preserves the manifest's original three-second post-load delay,
20-second host timeout, one warmup and five measured attempts. The check runs
after a real page timer supplies that delay. Nimbo uses its authenticated HTTP
API and a persistent celld host; upstream reported timings use cold CLI processes.
These timing methodologies must not be compared as identical measurements.
The four original `--dump` stages have no Nimbo output adapter yet and are
reported as `adapter-missing`, with zero executed attempts. They remain required
for a complete 33-stage pass; expression-based lookalikes are not substitutes.

The [recorded baseline](performance-obstacle-baseline.json) executed 174 real
HTTP extractions: **54 valid, 120 failed**. All six attempts passed in each of
nine stages. Twenty stages failed all six attempts; four more were unadapted.
This is **9/33 stages complete**, not a full-suite success.

The [namespace and iframe-interface repeat](performance-obstacle-namespaces.json)
uses the same pinned checkout, original expressions and expected values, unchanged
three-second delay, one warmup and five measured attempts. It executed **174 real
HTTP extractions: 66 valid, 108 failed**. React and Preact now pass all six attempts,
as do the nine previously passing stages. That repeat recorded **11/33 complete**:
18 failed and four unadapted. This does not establish complete React or Preact
compatibility, independent iframe execution or a full upstream suite pass.

The [corrected-transport decoding repeat](performance-obstacle-response-encoding.json)
executes all original evaluation stages with the same source revision, expected
values, three-second settle delay, one warmup and five measured attempts. It
records **174 real HTTP extractions: 72 valid, 102 failed**. The original Shift_JIS
page now passes all six attempts and the previously passing stages remain valid.
The current result is **12/33 complete**, with 17 failures and four output
adapters still missing. No original page or assertion was changed.

The following table records this latest repeat. The original baseline above is
retained as historical evidence.

| Original stage          | Category   | Status          | Valid / attempted |
| ----------------------- | ---------- | --------------- | ----------------- |
| `static`                | baseline   | passed          | 6/6               |
| `dom-build`             | perf       | failed          | 0/6               |
| `react`                 | frameworks | passed          | 6/6               |
| `preact`                | frameworks | passed          | 6/6               |
| `vue`                   | frameworks | passed          | 6/6               |
| `ssr-hydrate`           | modern-web | passed          | 6/6               |
| `es-modules`            | modern-web | failed          | 0/6               |
| `observer-intersection` | modern-web | failed          | 0/6               |
| `observer-mutation`     | modern-web | failed          | 0/6               |
| `storage-roundtrip`     | modern-web | passed          | 6/6               |
| `raf-update`            | modern-web | failed          | 0/6               |
| `modern-js-lang`        | modern-web | passed          | 6/6               |
| `modern-js-platform`    | modern-web | failed          | 0/6               |
| `spa-mini-app`          | modern-web | failed          | 0/6               |
| `async-render`          | capability | passed          | 6/6               |
| `spa-router`            | capability | failed          | 0/6               |
| `timers`                | capability | passed          | 6/6               |
| `web-component`         | web-api    | failed          | 0/6               |
| `url`                   | web-api    | failed          | 0/6               |
| `textdecoder`           | web-api    | passed          | 6/6               |
| `fileapi`               | web-api    | failed          | 0/6               |
| `range`                 | web-api    | failed          | 0/6               |
| `selection`             | web-api    | failed          | 0/6               |
| `custom-element`        | web-api    | passed          | 6/6               |
| `dialog`                | web-api    | failed          | 0/6               |
| `input-step`            | web-api    | failed          | 0/6               |
| `extract-article`       | extraction | adapter-missing | 0/0               |
| `extract-markdown`      | extraction | adapter-missing | 0/0               |
| `extract-links`         | extraction | adapter-missing | 0/0               |
| `extract-html`          | extraction | adapter-missing | 0/0               |
| `fingerprint`           | scraping   | failed          | 0/6               |
| `cookies`               | scraping   | failed          | 0/6               |
| `charset-shiftjis`      | scraping   | passed          | 6/6               |

The failures expose concrete next work: dynamic module graphs, text geometry,
MutationObserver, animation frames, history/URL, structuredClone, shadow DOM,
File API, Range/Selection, dialog/input methods, fingerprints, cookie behavior,
complete document/resource decoding and extraction modes. The original fixture values and
assertions stay fixed while the engine changes.

An earlier [completion-polling diagnostic](performance-obstacle-polling-diagnostic.json)
used the original fixtures and expressions but changed their settle timing. It
is retained as diagnostic evidence and does not replace the original-delay suite
result.

## Acceptance and reporting

Keep conformance, fingerprints, real-site outcomes, reliability and performance
as separate results. A detector's static HTML or crawler-rendered defaults are
not a Nimbo execution. Missing test harness APIs are not successful tests.
ServiceWorker or media-device property presence does not prove real worker,
video or audio execution. Numeric geometry is not a rendered pixel comparison.

For WPT, retain original test files and count subtests, failures, timeouts,
unsupported runner operations and unexecuted categories separately. The public
Obscura no-render tier excludes graphics/media/hardware from its headline scope;
Nimbo's full capability goal still includes those areas and rendering reference
tests. Never adopt those exclusions as completion of the broader goal.

For performance, distinguish cold processes from persistent browsers, protocol
costs, page creation, warmups, resource limits, concurrency and memory accounting.
Keep correctness gates enabled and retain unfavorable results. Real-site results
must distinguish target content from challenges, redirects and error pages,
with equal network conditions for comparators and no private operational data
in public reports.

For fingerprint suites, preserve the upstream expected values. Profile-specific
checks remain pending until Nimbo has corresponding native controls and actual
behavior. A fabricated GPU string, media object or quota must not be counted as
an implemented capability. Nimbo currently makes no full stealth parity claim.
