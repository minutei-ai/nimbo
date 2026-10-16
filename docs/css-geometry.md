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
enforce the source limit and recover on the same page. Those combinations,
mixed fonts and individual inline-fragment geometry remain pending. Diagnostic
errors retain a bounded excerpt of the unsupported declaration value.

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
the box's direction. Atomic inlines accept `vertical-align: baseline` and
`top`. Chromium moves the baseline-aligned set when a taller box is
bottom-aligned, so `bottom`, `middle` and text-relative values fail
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
