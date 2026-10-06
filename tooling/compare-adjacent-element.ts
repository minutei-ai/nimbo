import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/adjacent-element.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/adjacent-element\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "adjacent-element",
  fixturePath,
  26,
  "64 distinct fresh HTTP pages per runtime; actual native adjacent Element insertion, four positions, ASCII casing, detached nodes, argument conversion, hierarchy validation, moves, native-operation guards, adoption, live collections and custom reactions; supplemental fixture, not original WPT",
);
