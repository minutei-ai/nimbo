import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/positioned-generated.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/positioned-generated\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "positioned-generated",
  fixturePath,
  10,
  "64 distinct fresh HTTP pages per runtime; native empty absolute generated boxes, blockification, actual owner/ancestor containing blocks, percentage insets, border/padding, negative offsets, normal-flow exclusion, scroll overflow and mutations; supplemental fixture, not original WPT",
);
