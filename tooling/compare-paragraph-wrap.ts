import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/paragraph-wrap.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/paragraph-wrap\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "paragraph-wrap",
  fixturePath,
  14,
  "64 fresh HTTP pages per runtime; paragraph UA margins and grapheme-aware emergency wrapping with min-content, inheritance and mutation; original supplemental fixture, not original WPT",
);
