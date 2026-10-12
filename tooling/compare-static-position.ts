import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/static-position.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/static-position\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "static-position",
  fixturePath,
  11,
  "64 fresh HTTP pages per runtime; absolute boxes with definite size or size-independent alignment with static axes across containing blocks, border/padding/margins, flex alignment, mixed specified axes and mutation; original supplemental fixture, not original WPT",
);
