import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/text-baseline.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/text-baseline\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "text-baseline",
  fixturePath,
  10,
  "64 distinct fresh HTTP pages per runtime; real public font baselines across flex/grid, anonymous text, synthesis, borders/padding, nested blocks, wrapping, normal/fractional line height and mutations; supplemental contracts, not original WPT",
);
