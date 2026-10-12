import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/explicit-grid.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/explicit-grid\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "explicit-grid",
  fixturePath,
  23,
  "64 fresh HTTP pages per runtime; explicit tracks, numeric repetition, contextual lengths, spans, mutation and authored markerless lists; original supplemental fixture, not original WPT",
);
