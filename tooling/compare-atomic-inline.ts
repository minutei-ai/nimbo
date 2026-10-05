import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/atomic-inline.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/atomic-inline\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "atomic-inline",
  fixturePath,
  10,
  "64 distinct fresh HTTP pages per runtime; native one-atomic-box inline flow, font strut, real text baselines, intrinsic widths, overflow, contents, margins, ignored flex-item properties, mutations and fully authored buttons; supplemental contracts, not original WPT",
);
