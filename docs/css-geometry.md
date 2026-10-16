# Supported CSS geometry subset

This is the declared geometry subset for 0.5. Each row is backed by an original
synthetic fixture under `crates/engine/tests/fixtures/`. That fixture runs over
64 fresh real-HTTP pages in Chromium and in Nimbo's Worker/Wasm host
(`bun run compare:<fixture>`) and in the native suite without transport. A
row is supported only when every check passes in both runtimes.

Input outside this table fails explicitly with `layout unsupported: …`. It
never yields a manufactured measurement. All layout work is bounded by
`max_layout_nodes`, the 128-level depth limit, `max_dom_operations` and the page
deadline (see [layout traversal budget](browser-coverage.md#configurable-layout-traversal-budget)).

## Tolerances

Fixtures compare `getBoundingClientRect`, resolved `getComputedStyle` values
and derived offsets. Tolerances are written in each fixture's `near` helper and
recorded below:

- **Exact:** string results such as computed values, colors and keywords.
- **≤ 0.001 px:** borders, logical sizing, flex order and shaped advances.
- **≤ 0.005–0.01 px:** logical spacing, positioned and generated boxes, layout
  snapshot reuse, RTL boxes and inline text. Sub-pixel rounding of fractional
  lengths differs.
- **≤ 1/64 px:** clip and box-shadow rectangles (layout unit).
- **≤ 0.1 px:** explicit grid, static position, line clamp, size containment,
  inline-block and text wrapping. Line metrics use font units rounded to pixels.
- **≤ 1 px:** contextual box lengths that depend on viewport/font rounding.

## Subset and evidence

| Area                                        | Fixture                                                                      | Tolerance | Evidence                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Block box model, borders                    | `borders`                                                                    | 0.001     | [borders](evidence/borders-chromium.json), [box geometry](evidence/box-geometry-chromium.json)                                                                                                                                                                      |
| Logical sizing                              | `logical-size`                                                               | 0.001     | [logical-size](evidence/logical-size-chromium.json)                                                                                                                                                                                                                 |
| Logical margin/padding/inset                | `logical-spacing`                                                            | 0.005     | [logical-spacing](logical-spacing-chromium.json)                                                                                                                                                                                                                    |
| Logical borders                             | `logical-borders`                                                            | exact     | [logical-borders](evidence/logical-borders.json)                                                                                                                                                                                                                    |
| Contextual lengths (em, rem, vw, vh, ch, %) | `contextual-box-lengths`                                                     | 1         | [contextual-box-lengths](contextual-box-lengths-chromium.json)                                                                                                                                                                                                      |
| Resolved box values                         | `resolved-box-values`                                                        | exact     | [resolved-box-values](resolved-box-values-chromium.json)                                                                                                                                                                                                            |
| Explicit grid tracks, spans, lines          | `explicit-grid`                                                              | 0.1       | [explicit-grid](evidence/explicit-grid-chromium.json)                                                                                                                                                                                                               |
| Flex order and alignment                    | `order-layout`                                                               | 0.001     | [order-layout](evidence/order-layout.json)                                                                                                                                                                                                                          |
| Inline-block and atomic inline              | `inline-block`, `atomic-inline`                                              | 0.1       | [inline-block](evidence/inline-block-chromium.json), [atomic-inline](evidence/atomic-inline.json)                                                                                                                                                                   |
| Relative/absolute/fixed positioning         | `positioned-boxes`                                                           | 0.01      | [positioned-boxes](evidence/positioned-boxes-chromium.json)                                                                                                                                                                                                         |
| Absolute static position                    | `static-position`                                                            | 0.1       | [static-position](evidence/static-position-chromium.json)                                                                                                                                                                                                           |
| Sticky positioning                          | `sticky-geometry`                                                            | exact     | [sticky](evidence/sticky-geometry-comparison.json)                                                                                                                                                                                                                  |
| Stacking order                              | `z-index`                                                                    | exact     | [z-index](z-index-chromium.json)                                                                                                                                                                                                                                    |
| Generated before/after boxes                | `generated-boxes`                                                            | 0.01      | [generated-boxes](evidence/generated-boxes-chromium.json)                                                                                                                                                                                                           |
| Size containment, container queries         | `size-containment`                                                           | 0.1       | [size-containment](evidence/size-containment-chromium.json), [container queries](evidence/container-queries-chromium.json)                                                                                                                                          |
| Line clamp                                  | `line-clamp`                                                                 | 0.1       | [line-clamp](evidence/line-clamp-chromium.json)                                                                                                                                                                                                                     |
| Clip and box-shadow geometry                | `clip-geometry`, `box-shadow-geometry`                                       | 1/64      | [clip](evidence/clip-geometry.json), [box-shadow](evidence/box-shadow-geometry.json)                                                                                                                                                                                |
| Outer SVG viewport                          | `svg-viewport`                                                               | exact     | [svg-viewport](svg-viewport-chromium.json)                                                                                                                                                                                                                          |
| Canvas and authored input boxes             | `canvas-box`, `authored-inputs`                                              | 0.1       | [canvas-box](evidence/canvas-box-chromium.json), [authored-inputs](evidence/authored-inputs-chromium.json)                                                                                                                                                          |
| Text alignment of atomic inlines            | `text-align`                                                                 | 0.1       | [text-align](evidence/text-align-chromium.json)                                                                                                                                                                                                                     |
| Atomic inline `vertical-align: top`         | `vertical-align`                                                             | 0.1       | [vertical-align](evidence/vertical-align-chromium.json)                                                                                                                                                                                                             |
| Right-to-left boxes                         | `rtl-boxes`                                                                  | 0.01      | [rtl-boxes](evidence/rtl-boxes-chromium.json)                                                                                                                                                                                                                       |
| Stale-cache invalidation                    | `layout-snapshot`                                                            | 0.01      | [layout-snapshot](layout-snapshot-chromium.json)                                                                                                                                                                                                                    |
| Text wrapping and headings                  | `paragraph-wrap`, `inline-text`, `pre-line`, `headings`, `latin-punctuation` | 0.01–0.1  | [paragraph-wrap](evidence/paragraph-wrap-chromium.json), [inline-text](evidence/inline-text-chromium.json), [pre-line](evidence/pre-line-chromium.json), [headings](evidence/headings-chromium.json), [latin-punctuation](evidence/latin-punctuation-chromium.json) |

## Baseline inline text

Same-font `span`, `a`, `label` and `abbr` wrappers accept explicit
`vertical-align: baseline` and its `initial`, `unset` and `revert` defaults.
They share the existing text shaping and baseline policy with atomic inline
boxes, preserving word wrapping, kerning and nested text. This follows the
[CSS baseline alignment rule](https://www.w3.org/TR/CSS22/visudet.html#propdef-vertical-align).

The shared `inline-baseline` fixture checks 18 cases in native Rust, Worker/Wasm
and independently in Chromium, including stylesheet mutation and reflow.
A separate native/Worker boundary case rejects `middle`, resets the declaration
to `baseline` and recovers on the same page. Other alignment values and inline
fragment geometry retain their explicit boundaries.

## Horizontal padding in inline text

Same-font inline wrappers retain their left/right padding as explicit text-flow
advances. Lengths use the existing native font context; Taffy resolves
percentages against the containing width. Harfrust measures glyph spans between
those edges.
Whitespace normalization keeps edge positions, including terminal line breaks.
Padding participates in intrinsic width, wrapping, emergency breaks and scroll
overflow without inserting synthetic whitespace or changing DOM text.

The shared `inline-padding` fixture checks 32 cases in native Rust, Worker/Wasm
and independently in Chromium. It covers nested and empty wrappers, collapsed
spaces, Unicode, logical RTL sides, percentages, relative lengths, pure-length
calculations, explicit breaks, mutation, removal and reattachment. Edge visits
charge the existing text-work budget; source and layout bounds still apply.
Boundary cases reject unsupported vertical padding and transformed padded text,
enforce the source limit and recover on the same page. Those combinations and
individual inline-fragment geometry remain pending. Diagnostic errors retain a
bounded excerpt of the unsupported declaration value.

Ordinary text keeps a direct normalization and measurement path. The
[synthetic text benchmark](evidence/inline-text-layout-2026-10-16.json) uses
celld 0.6.1, fresh HTTP pages, alternating builds, three warmups and sixteen
measurements with each build first eight times. Both builds completed 19/19
requests. This run measured p50 88.5 → 82.2 ms and p95 103.7 → 102.8 ms;
maximum process-tree RSS after requests was 493 → 503 MiB. These are local host
readings, not Worker isolate heap or production latency. The report retains
artifact/fixture hashes, effective budgets and every sample. Reproduce with
`NIMBO_BENCH_BASELINE_BUNDLE=<baseline-bundle> bun run bench:hot-paths inline-text-layout`.

## Right-to-left subset

`dir="rtl"`, `dir="ltr"` and the `direction` property set an inherited inline
base direction for horizontal-tb boxes. Block, flex and grid placement,
absolute insets, and logical margin, padding, border and inset properties map
to the right-to-left physical sides. `getComputedStyle` reports `direction` and
resolved logical box values. Invalid `dir` values inherit. `dir="auto"` takes
the first strong character of descendant text in tree order. It skips script,
style, textarea and bdi elements and descendants with their own `dir`, and
falls back to `ltr`. `text-align` `left`, `right`, `center`, `start` and `end`
place atomic inline boxes on each line, with `start`/`end` resolved against
the box's direction. Atomic inlines accept `vertical-align: baseline`,
`top` and `middle`. Chromium moves the baseline-aligned set when a taller box is
bottom-aligned, so `bottom` and other text-relative values fail
explicitly. Inline fragment geometry, `justify`, transitions of
logical properties under `rtl`, and vertical or sideways writing modes stay
unsupported.

## Stale caches and bounds

`layout-snapshot` repeats reads and then mutates rules, selector text, sheet
state, adopted sheets, attributes, inline styles, ancestor sizes, parents,
detachment and `display`. It checks that each read reflects the mutation. The
RTL fixture also flips `dir` on a laid-out tree. Worker cases reach the
1024-node and 128-depth limits and the DOM operation budget, then accept a
fresh request.

## Not covered

Intrinsic `min-content`/`max-content` sizing beyond the fixtures above, nested
grid subgrids, scrolling overflow and scrollbars, floats, multi-column,
fragmentation, tables, vertical writing modes, transforms beyond translation,
and painting. [Browser coverage](browser-coverage.md) records each family's
history. Where older notes there disagree with this table, this table is
current.

## Mixed inline and block children

Block containers group adjacent text and same-font inline wrappers into anonymous
text blocks around in-flow block siblings, following the
[CSS anonymous block model](https://www.w3.org/TR/CSS22/visuren.html#anonymous-block-level).
These groups reuse the existing text shaping, whitespace normalization, padding
and line wrapping. Anonymous boxes have no DOM identity or margins; inherited
text metrics come from the container. Absolutely positioned and fixed siblings
do not split a text group. Flex and grid keep their native text-item handling.

The shared `mixed-inline-blocks` fixture checks 21 cases in native Rust,
Worker/Wasm and independently in Chromium, including sibling positions, margins,
wrapping, resize, removal and reattachment. Boundary cases retain explicit
rejection of mixed inline flow policies, blocks inside inline wrappers, text
through `display:contents` and inline-fragment geometry. They enforce the text source
limit and check recovery on the same page. Anonymous text boxes charge the
existing layout budget as well as text work.

## Multiple inline font metrics

Text collection preserves font-size, family, weight, style, letter spacing and
line-height for each text span. Whitespace normalization remaps their UTF-8 byte
boundaries along with padding edges. Ordinary same-font text retains its direct
path; mixed spans share font selection and advance caches by their computed
metrics within the text run. Registry comparisons, span visits and shaping
charge the existing text-work budget with target-independent weights.

Each line combines the container's font strut with the ascent and descent of
its text and inline boxes, following the
[CSS line-height model](https://www.w3.org/TR/CSS22/visudet.html#line-height).
Empty wrappers can contribute to a nonempty line. A larger span affects the lines
it occupies; it does not set one height for the entire paragraph. Taffy receives
first and last baselines from those actual lines.

The shared `inline-font-metrics` fixture checks 35 cases in native Rust,
Worker/Wasm and Chromium in standards mode, including IntersectionObserver.
The tight-line comparison allows one CSS pixel for font-metric rounding; the
native boundary fixture separately requires its exact current 21px result.
Other cases retain their explicit geometry assertions. Boundary cases also
check source and shaping budgets and recovery on the same page.

Mixed white-space, direction, transformation, language and alignment policies
remain explicit unsupported boundaries. Applying text transformation to mixed
metrics also remains unsupported. Per-glyph fallback with different line
metrics and individual inline-fragment rectangles retain their existing
boundaries.

The [retained-path benchmark](evidence/inline-font-metrics-2026-10-16.json) compares
two local rounds with a separately rebuilt `55a5156` baseline, using the same
Worker JavaScript, celld version, HTTP fixture and limits. Each build completes
19/19 requests per round. Baseline/candidate p50 values are 81.76/83.69ms and
74.59/64.46ms; p95 values are 99.46/91.40ms and 109.25/105.43ms. These repetitions
do not establish a speedup or stable latency delta. RSS is process-tree memory
sampled after requests, not page heap or peak memory. Mixed-metric performance
has no equivalent baseline because that version rejects the input.

## Selection declarations in geometry

Layout classifies the `user-select` family through LightningCSS's native
`PropertyId::UserSelect`, including the unprefixed, WebKit, Mozilla and Microsoft
forms it parses. These declarations leave block and inline box dimensions
unchanged. The shared `user-select-geometry` fixture checks 44 cases in native
Rust, Worker/Wasm and Chromium in standards mode, including stylesheet mutation,
removal and resize.

The native `user-select-contract` fixture checks 16 grammar, CSSOM and recovery
cases. Invalid values keep the prior declaration, unknown properties follow
native parser filtering, and unsupported prefixed transforms still fail.
This evidence covers geometry and declarations; interactive selection and
computed `user-select` values remain outside this geometry subset.

## Semantic inline emphasis

The HTML box owner defines the text-inline categories and their user-agent
styles. `i`, `em`, `cite`, `dfn` and `var` use italic; `b` and `strong` use an
inherited relative weight. The collector consumes that same category instead
of maintaining a second tag list. These defaults follow the
[HTML phrasing-content rules](https://html.spec.whatwg.org/multipage/rendering.html#phrasing-content-3).
Author styles, font shorthands and inherited values override the defaults;
`revert` restores them, including after variable substitution.

Layout and `getComputedStyle` share native font traits. `font-style` and
`font-weight` computed values are available. Weight inheritance uses the
[CSS relative-weight ranges](https://www.w3.org/TR/css-fonts-4/#relative-weights),
preserving the 1–1000 range. Invalid weights and oblique angles are rejected at
the declaration boundary, including in font shorthands. Native font-number
precision is retained: `3.14` remains `3.14`, whereas the observed Chromium
computed value is quantized to `3`.

The shared `semantic-emphasis` fixture has 40 checks independently compared
with Chromium in standards mode, covering defaults, authored rules, relative
weights, nesting, padding, block siblings, mutation and reattachment. Native
Rust and Worker/Wasm additionally run 15 grammar and boundary checks. Oblique
shaping, generated inline text, fragment rectangles, nested atomic formatting,
unsupported HTML categories and foreign namespaces retain explicit boundaries;
recovery is checked on the same page.

The [retained-path benchmark](evidence/semantic-emphasis-2026-10-16.json) compares
two local rounds with a separately rebuilt `4badfb2` baseline. Both builds
complete 19/19 requests per round. Baseline/candidate p50 values are
68.81/58.26ms and 66.66/74.95ms; p95 values are 103.82/80.86ms and
117.34/105.86ms. The mixed p50 results do not establish a speedup or stable
latency delta. Wasm grows by 8,025 bytes. RSS samples measure process-tree memory
after requests, not peak memory or page heap. The semantic emphasis path has no
equivalent baseline because that version rejects the input.

## Native button flow

HTML buttons use native Taffy fit-content dimensions, flow-root layout and safe
content alignment. Ordinary flow buttons center their content vertically when
it fits and keep overflowing content at the start. The reference Chromium also
retains that centering with authored `align-content:start` or `end`; flex/grid
buttons keep their authored layout. Absolutely positioned buttons use Taffy's
native inset sizing. Inline flow and `display:initial` resolve to inline-block;
block display keeps its computed value while establishing a flow-root layout.
These behaviors follow the
[HTML button layout contract](https://html.spec.whatwg.org/multipage/rendering.html#button-layout)
and the independently observed reference behavior.

The shared HTML default owner supplies the reference profile's button font,
box sizing, text alignment, padding and border geometry: 13.333333px Arial,
border-box, centered text, 1px/6px padding and a 2px outset border. Author rules
override these defaults through the existing cascade. This is geometry support;
native platform painting is outside this engine's output.

The shared `button-flow` fixture checks 36 cases in native Rust, Worker/Wasm and
Chromium in standards mode: automatic and explicit widths, text metrics,
centering, overflow, borders, empty contents, flex items, display contents,
disabled state, resizing, defaults, absolute positioning and native appearance
aliases. Appearance classification uses LightningCSS's `PropertyId::Appearance`,
including its WebKit, Mozilla and Microsoft forms. The existing
authored flex/grid button and input contracts remain separate checks.

The native `button-flow-boundary` fixture adds 15 grammar, invalid-syntax,
unsupported-appearance, namespace, input-control and recovery checks. Geometry
comparison does not imply that Chromium parses every vendor-prefixed alias.
The existing context-free `CSS.supports` layout probe still reports appearance
as unsupported; these checks validate declarations and actual button layout,
not that capability-reporting gap.

The [retained-path benchmark](evidence/button-flow-2026-10-16.json) compares three
local rounds with the verified `1550b5d` artifact. Both builds complete 19/19
requests per round. Baseline/candidate p50 values are 82.90/83.73ms,
73.73/89.28ms and 83.09/75.03ms; p95 values are 96.28/98.36ms,
105.97/111.62ms and 114.41/93.37ms. The variation does not establish a stable
latency delta. Wasm grows by 681 bytes. RSS is sampled process-tree memory after
requests, not peak memory or page heap. Ordinary button flow has no equivalent
baseline because that version rejects the input.

## Static inline insets

Inline validation accepts physical and logical insets when the inline element
uses static positioning, including omitted position, `initial`, `unset` and
`revert`. The declarations remain available to CSSOM; they do not offset text,
change line wrapping or enlarge scrollable geometry. This follows
[CSS Positioned Layout](https://www.w3.org/TR/css-position-3/#position-property):
inset properties do not apply to static boxes. The existing logical-property
owner classifies inset declarations; there is no separate alias list or layout
path.

The shared `static-inline-insets` fixture checks 58 cases in Rust, Worker/Wasm
and Chromium in standards mode, including percentages, contextual lengths,
calculations, shorthands, variables, reattachment and a positioned parent.
Six native boundary checks retain explicit failures for relative, sticky and
inherited inline positioning and individual inline-fragment rectangles, and
verify declaration validation and recovery. Positioned inline text remains
outside this geometry subset.

The [retained-path benchmark](evidence/static-inline-insets-2026-10-16.json)
compares two local rounds with the verified `3ba9619` artifact. Both builds
complete 19/19 requests per round. Baseline/candidate p50 values are
72.24/72.04ms and 87.64/71.76ms; p95 values are 119.83/90.71ms and
107.29/93.92ms. These repetitions do not establish a stable latency delta.
Wasm grows by 331 bytes. RSS measures process-tree memory after requests, not
peak memory or page heap. The new static-inset path has no equivalent baseline
because that version rejects the input.

## Middle alignment of atomic inline boxes

`inline-block` and `inline-flex` boxes accept `vertical-align: middle`. Taffy
still sizes and positions the boxes. The native layout owner adjusts their
alignment baseline using their margin-box midpoint and the actual parent's
x-height, read from the selected font through Harfrust/read-fonts. Missing or
invalid x-height metadata remains an explicit error.

Font inheritance and the parent formatting box remain distinct through
`display: contents`. Clipped middle-aligned boxes use a separate native
flex-item style view to avoid flex scroll-container baseline clamping; their
own layout, clipping and programmatic scrolling keep the original style.
That view is derived afresh for every layout compute, including percentage
padding resolution. This follows the
[CSS vertical-alignment contract](https://www.w3.org/TR/CSS22/visudet.html#propdef-vertical-align).

The shared `atomic-middle` fixture checks 37 cases in Rust, Worker/Wasm and
Chromium in standards mode: three explicit Liberation families, margins,
different child fonts, borders, percentage padding, clipping and scrolling,
intrinsic sizing, resize, reattachment, parent-font changes, buttons,
multiple boxes, wrapping, mixed baselines and contents. Its geometric criteria
use each runtime's independently measured parent strut and the font profile's
x-height; they do not assert identical absolute font-baseline rounding.
Middle alignment of ordinary text inlines and other unsupported alignment
values retain their existing boundaries.

The [retained-path comparison](evidence/atomic-middle-2026-10-16.json)
uses the same baseline-aligned atomic boxes in both builds, real local HTTP,
alternating versions and three rounds of 3 warmups plus 16 measured requests.
Both builds complete 19/19 requests per round. Baseline/candidate p50 values
are 84.89/91.94, 79.08/90.61 and 66.47/68.83 ms; p95 values are
116.86/110.52, 103.87/121.35 and 101.45/90.77 ms. Candidate p50 is higher
in all three rounds; this small local comparison does not isolate the cause
or establish a stable latency delta. This change claims coverage, not a
speedup. Wasm grows by 8,311 bytes. Middle alignment itself has no equivalent
baseline because that version rejects the input.
