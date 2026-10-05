import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/rounded-box.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/rounded-box\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "rounded-box",
  fixturePath,
  6,
  "64 fresh HTTP pages per runtime with varied physical border radii and user-select declarations; unchanged native rectangular box/scroll geometry and actual IntersectionObserver root/clipping rectangles; geometry contracts only, not rounded painting or computed-radius/user-select or selection API parity; supplemental contracts, not original WPT",
);
