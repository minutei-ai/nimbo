import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/order-layout.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/order-layout\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "order-layout",
  fixturePath,
  9,
  "64 fresh HTTP pages per runtime; stable order-modified flex/grid geometry, reversal, block no-op, generated boxes, display:contents flattening, mutation and computed order; supplemental contracts, not original WPT",
);
