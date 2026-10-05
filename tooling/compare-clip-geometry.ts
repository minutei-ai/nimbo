import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/clip-geometry.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/clip-geometry\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "clip-geometry",
  fixturePath,
  15,
  "64 distinct fresh HTTP pages per runtime; native inset and polygon bounding rectangles, percentage/calc/font/viewport coordinates, mutations, root exclusion/eligibility, hidden targets, empty/degenerate paths and actual containing-block ancestry; IntersectionObserver v1 geometry only, not shape painting or general SVG clipping; original supplemental fixture, not WPT",
);
