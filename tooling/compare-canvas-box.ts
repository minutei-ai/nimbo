import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/canvas-box.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/canvas-box\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "canvas-box",
  fixturePath,
  15,
  "64 fresh HTTP pages per runtime; canvas replaced sizing from attributes, CSS, constraints, borders, mutation and percentages; original supplemental fixture, not original WPT",
);
