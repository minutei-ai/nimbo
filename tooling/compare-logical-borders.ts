import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/logical-borders.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/logical-borders\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "logical-borders",
  fixturePath,
  20,
  "64 fresh HTTP pages per runtime; horizontal LTR logical border sides, cascade priority, inheritance, mutation and width snapping; original supplemental fixture, not original WPT",
);
