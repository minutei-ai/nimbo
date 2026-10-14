import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/vertical-align.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/vertical-align\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "vertical-align",
  fixturePath,
  6,
  "64 fresh HTTP pages per runtime; vertical-align baseline and top for atomic inline boxes with flat and font struts, a tall top-aligned box, mutation, and bottom either rejected (Nimbo) or bottom-aligned; original supplemental fixture, not original WPT",
);
