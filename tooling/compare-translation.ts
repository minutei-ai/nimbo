import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/translation.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/translation\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "translation",
  fixturePath,
  19,
  "64 fresh HTTP pages per runtime; CSS translation geometry, offset invariance, containing blocks, scroll overflow, clipping and IntersectionObserver; original supplemental fixture, not original WPT",
);
