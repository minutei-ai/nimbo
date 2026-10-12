import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/selector-index.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/selector-index\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "selector-index",
  fixturePath,
  17,
  "64 fresh HTTP pages per runtime; descendant and child selectors, positive alternatives, shared predicates, sibling selectors and ancestor class mutation; original supplemental fixture, not original WPT",
);
