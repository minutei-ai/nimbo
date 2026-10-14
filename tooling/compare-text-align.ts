import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/text-align.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/text-align\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "text-align",
  fixturePath,
  13,
  "64 fresh HTTP pages per runtime; text-align left/right/center/start/end for atomic inline boxes in LTR and RTL, inheritance, initial, wrapped lines and mutation; original supplemental fixture, not original WPT",
);
