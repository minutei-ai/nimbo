# Text scripts and fonts

## Declared script matrix

| Script   | ISO 15924 | Direction     | Shaping                                           |
| -------- | --------- | ------------- | ------------------------------------------------- |
| Latin    | `Latn`    | left-to-right | GSUB/GPOS, ligatures, kerning, combining marks    |
| Greek    | `Grek`    | left-to-right | GSUB/GPOS                                         |
| Cyrillic | `Cyrl`    | left-to-right | GSUB/GPOS                                         |
| Hebrew   | `Hebr`    | right-to-left | GSUB/GPOS                                         |
| Arabic   | `Arab`    | right-to-left | GSUB/GPOS, including `init`/`medi`/`fina` joining |

Text is split into maximal runs of one script. Common and inherited characters
(spaces, digits, punctuation, combining marks) join the preceding run, or the
first script run when they lead the text. Each run is shaped by HarfRust with
its own script and direction, so Arabic joining applies only inside Arabic runs
and Latin kerning still applies to Latin inside right-to-left text. Widths sum
over runs and are independent of visual order. Nimbo exposes box geometry only,
with no per-glyph positions, so bidi reordering changes no reported value.

These inputs fail explicitly with `layout unsupported: …`:

- scripts outside the matrix (for example Thai, Devanagari and Han);
- explicit bidi formatting characters (embeddings, overrides and isolates);
- mirrored characters, such as brackets, inside right-to-left runs;
- `letter-spacing` on Arabic text;
- a character no candidate face can render.

`text-align` other than `left`/`start` stays unsupported (see
[CSS geometry](css-geometry.md)).

## Font fallback

Layout text selects faces from the `font-family` list in order, and from every
`unicode-range` subset of a family. Each character uses the first face whose
`unicode-range` covers it and whose cmap has a glyph. Combining marks stay with
their base character's face. Consecutive characters on one face form a
segment, which is then itemized by script. When fallback faces are in play,
their normal line metrics must match the primary face. Otherwise the text
fails, rather than growing line boxes approximately. Text that a single face
covers keeps the original single-face path. Canvas text still requires one
face.

## Fonts, references and classification

Fixtures load deterministic synthetic TrueType fonts over real HTTP, so the
same glyph data reaches Chromium and Nimbo. `tooling/generate-scripts-font.py`
(fonttools 4.60.1) reproduces `synthetic-scripts-font.ttf` byte for byte. Its
glyphs have distinct advances, and its Arabic joining and Latin kerning are
script-scoped, so an itemization error changes the measured width.

A difference is classified as follows:

- **Engine error:** a difference with a fixture font. Fixture fonts fully define
  glyph coverage and advances.
- **Font-dependent:** behavior that requires a system or generic font, such as
  missing-glyph fallback to fonts outside the page. Nimbo rejects these inputs
  instead of measuring with different font data, and comparisons never use
  them as passes.
- **Rounding:** Chromium rounds each shaped text fragment's box geometry to
  1/64 px. Box checks allow one layout unit per fragment. Canvas widths are
  compared within 0.001 px.

## Evidence

Each fixture passes 64 real-HTTP pages in Chrome for Testing 153 and the Worker
host, plus the native suite:

- [font-scripts](evidence/font-scripts-chromium.json): Greek, Cyrillic, Hebrew
  and Arabic joining, mixed scripts and right-to-left numbers, in canvas and
  inline-block widths (18 checks).
- [font-fallback](evidence/font-fallback-chromium.json): family-list fallback,
  `unicode-range` subsets, shaping inside fallback runs and a family mutation
  (8 checks).
- [font-shaping](evidence/font-shaping-widths.json),
  [paragraph-wrap](evidence/paragraph-wrap-chromium.json) and
  [text layout](evidence/text-layout.json) cover the Latin path. After the run
  split they were rerun with unchanged fixtures and still pass
  ([font-shaping rerun](evidence/font-shaping-rerun-chromium.json),
  [text layout rerun](evidence/text-layout-rerun-chromium.json)).

Late fonts and font changes reuse the bounded font-loading path
([css-font-loading](evidence/css-font-loading-chromium.json)). Layout repeats
only on DOM, style or font registry changes, under the existing traversal,
shaping-byte (1 MiB) and time budgets.
