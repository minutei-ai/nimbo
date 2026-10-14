import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/rtl-boxes.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/rtl-boxes\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "rtl-boxes",
  fixturePath,
  19,
  "64 fresh HTTP pages per runtime; horizontal-tb right-to-left block, flex, grid and absolute boxes from dir and direction, logical margin/padding/border/inset mapping, computed direction, author override, dir mutation, auto/invalid dir and an LTR control; original supplemental fixture, not original WPT",
);
