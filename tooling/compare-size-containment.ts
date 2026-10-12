import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/size-containment.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/size-containment\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "size-containment",
  fixturePath,
  9,
  "64 fresh HTTP pages per runtime; empty intrinsic contributions in contained axes, block/flex/grid allocation, descendant layout, insets, mutation and container queries; original supplemental fixture, not original WPT",
);
