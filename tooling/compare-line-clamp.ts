import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/line-clamp.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/line-clamp\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "line-clamp",
  fixturePath,
  6,
  "64 fresh HTTP pages per runtime; legacy vertical text clamping, intrinsic height, unclamped scroll extent, padding, borders, mutation and computed display; original supplemental fixture, not original WPT",
);
