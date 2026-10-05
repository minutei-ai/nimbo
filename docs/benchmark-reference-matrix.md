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
The [original URL subset](performance-wpt-url.json) now executes 24 `.any.js`
files and all 30 window-global META variants through the original harness.
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
That decoding repeat records **12/33 complete**, with 17 failures and four output
adapters still missing. No original page or assertion was changed.

The [native URL repeat](performance-obstacle-url.json) preserves the same original
fixtures, expectations, source revision, three-second delay, one warmup and five
measured attempts. It records **174 real HTTP extractions: 78 valid, 96 failed**.
The original URL fixture now passes all six attempts, retaining every previously
passing stage. That URL repeat records **13/33 complete**, with 16 failed stages
and four unadapted outputs. This does not establish full URL, SPA or browser
conformance; the original WPT failures remain visible below.

The [shared-cookie repeat](performance-obstacle-cookies.json) preserves every
original fixture, expression, expected value, three-second delay and attempt
count. The original cookies stage now passes all six attempts, retaining the
13 previously passing stages. It records **174 real HTTP extractions: 84 valid,
90 failed**. The current result is **14/33 complete**, with 15 failed stages and
four missing output adapters. This does not establish full cookie conformance
or a complete upstream-suite pass.

The following table records this latest repeat. All previous reports above remain
historical evidence.

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
| `url`                   | web-api    | passed          | 6/6               |
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
| `cookies`               | scraping   | passed          | 6/6               |
| `charset-shiftjis`      | scraping   | passed          | 6/6               |

The failures expose concrete next work: dynamic module graphs, text geometry,
MutationObserver, animation frames, History and remaining URL parsing, structuredClone, shadow DOM,
File API, Range/Selection, dialog/input methods, fingerprints, complete cookie semantics,
complete document/resource decoding and extraction modes. The original fixture values and
assertions stay fixed while the engine changes.

An earlier [completion-polling diagnostic](performance-obstacle-polling-diagnostic.json)
used the original fixtures and expressions but changed their settle timing. It
is retained as diagnostic evidence and does not replace the original-delay suite
result.

The [three-runtime repeat after shared cookies](performance-comparison-cookies.json)
uses the same nine supplemental scenarios, rotating runtime order, three warmups
and 21 measured attempts. All 648 extractions are valid, with zero failures and
567 measured samples. Nimbo has lower p50 than Chromium in 9/9 scenarios and
lower p50 than public Obscura in 1/9; the remaining performance goal is open.
This comparison does not replace the original 33-stage suite or establish
causal speed changes from the cookie implementation.

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

## Original URL WPT adapter

Set `NIMBO_WPT_REFERENCE_ROOT` privately to a checkout of the original WPT
repository at the revision above. The runner verifies SHA-256 for every original
harness, test, dependency and data file against the
[source manifest](../tooling/wpt-url-sources.json) before launching celld.

```sh
git clone https://github.com/web-platform-tests/wpt.git "$NIMBO_WPT_REFERENCE_ROOT"
git -C "$NIMBO_WPT_REFERENCE_ROOT" checkout 03f14d4780c4d981bc84c65679b18e9327a1affe
bun run bench:wpt-url
```

The HTTP adapter generates window wrappers from the original META dependencies,
query variants and long-timeout marker. It uses the original window-global
metadata from `tools/serve/serve.py`, retains the server's WebIDLParser rewrite,
and observes `testharness.js` completion callbacks. HTML output and cross-window
message reporting are disabled through harness configuration. Assertions, test
data and expected values remain unchanged. Each variant owns a fresh Nimbo page
with the default engine limits.

The [Nimbo report](performance-wpt-url.json) includes every failed assertion and
incomplete variant. The [Chromium report](evidence/wpt-url-chromium.json) retains
all failures from the same adapter and original source revision. A nonzero
runner exit is expected while any variant fails or cannot complete. No full WPT,
full URL-suite, dedicated-worker, browser-stealth or production runtime pass is
claimed. This adapter does not replace the complete WPT server or remaining
original suites.

## Original CSS transition WPT contracts

`bun run bench:wpt-transitions` uses the original seventeen parsing, computed,
shorthand and behavior HTML files at the pinned WPT revision above. Original
helpers and harness are SHA-verified by `tooling/wpt-transitions-sources.json`;
only vendor reporting is appended. Select the original checkout with
`NIMBO_WPT_REFERENCE_ROOT` and binaries through the private comparison settings.

The [dated report](performance-wpt-transitions.json) records Nimbo/celld at
146/157 completed subtests, eleven failures and one incomplete 28-subtest file.
Chromium is 183/185; public Obscura 0.2.3 is 41/185. Neither failed assertions nor
incomplete files count as passes. The command exits unsuccessfully when any
runtime has a failed or incomplete file. Full transition behavior remains an
obligation; see the [native implementation scope](browser-coverage.md#native-css-transition-timelines).

## Original logical box spacing WPT contracts

`bun run bench:wpt-logical-spacing` executes sixteen original logical
margin/padding/inset and physical inset parsing, computed and shorthand HTML
files at WPT revision `03f14d4780c4d981bc84c65679b18e9327a1affe`. Five original
helpers and the HTML files are SHA-verified against
`tooling/wpt-logical-spacing-sources.json`. Vendor reporting has only a
reporting adapter; assertions and original source bytes remain unchanged.

The [dated report](performance-wpt-logical-spacing.json) records Nimbo/celld at
126/181 subtests, Chromium at 181/181 and public Obscura 0.2.3 at 53/181. Nimbo
passes ten files and fails six; no file is incomplete. Computed spacing and calc
serialization remain failures. The runner correctly exits unsuccessfully.
These original results are separate from the supplemental geometry and
real-clock transition fixture; neither establishes full logical CSS parity.

## Original contextual length WPT contracts

`bun run bench:wpt-contextual-box-lengths` runs eleven original absolute-unit,
element-font, root-rem, viewport-unit and invalid sizing HTML files with the original harness
and parsing helper. `tooling/wpt-contextual-box-lengths-sources.json` pins every
file at WPT revision `03f14d4780c4d981bc84c65679b18e9327a1affe`. Assertions and
source bytes are unchanged; the adapter only reports the vendor result.

The [dated report](performance-wpt-contextual-box-lengths.json) records
Nimbo/celld at 64/78 completed subtests, seven passing files, three failed files
and one incomplete iframe file. Chromium passes 112/112; public Obscura passes
33/112. All six original invalid width/height/min/max parsing files pass in Nimbo.
The 34 subtests in Chromium's iframe file are not counted as Nimbo passes or
completed assertions. The command exits unsuccessfully. Full computed box CSSOM,
frames and the broader original CSS Values suite remain obligations; these eleven
files do not stand in for the complete upstream suite.

The subsequent [native resolved-box report](performance-wpt-resolved-box-values.json)
runs the identical eleven source files and assertions. Nimbo/celld now passes
78/78 completed subtests across ten files; one iframe file remains incomplete.
Chromium is 112/112 and public Obscura is 33/112. Its missing 34 iframe assertions
are still unexecuted obligations, not successes.

The [logical-spacing rerun with resolved-box CSSOM](performance-wpt-resolved-logical-spacing.json)
retains the original sixteen files: Nimbo/celld remains at 126/181, Chromium
181/181 and public Obscura 53/181. Margin/padding computed tests now reach native
layout but fail on absolute static positioning in the original document. Insets,
shorthand CSSOM and canonical calc serialization remain gaps. No original
assertions or markup were changed to remove those failures.

## Original document stylesheet list WPT

The [manifest](../tooling/wpt-document-stylesheets-sources.json) pins
`StyleSheetList.html`, `StyleSheetList-constructable.html` and
`StyleSheetList-constructable-with-style-recalc.html`, plus both original harness
resources, to the shared upstream revision. Original bytes and assertions are
unchanged; only vendor result reporting is appended. Run
`bun run bench:wpt-document-stylesheets` with the original pinned source root.

The [report](performance-wpt-document-stylesheets.json) records Nimbo/celld 1/3,
Chromium 3/3 and public Obscura 3/3. Both Nimbo adoption files fail on missing
Window named element access (`sheet1 is not defined`). Supplemental explicit
DOM-access fixtures verify adoption exclusion, but do not replace the original
assertions. The command remains unsuccessful; Window named properties, imports,
grouped CSSOM and full owner-association lifecycle remain obligations.
