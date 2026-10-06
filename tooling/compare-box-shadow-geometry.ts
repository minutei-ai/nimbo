import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/box-shadow-geometry.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/box-shadow-geometry\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "box-shadow-geometry",
  fixturePath,
  16,
  "64 distinct fresh HTTP pages per runtime; outer, negative, inset, font-relative, calc and multiple box-shadow ink excluded from actual rectangles, scrollable overflow and IntersectionObserver v1 geometry; variable substitution and mutations; supplemental fixture, not original WPT",
);
