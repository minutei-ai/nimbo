import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/authored-button.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/authored-button\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "authored-button",
  fixturePath,
  8,
  "64 distinct fresh HTTP pages per runtime; font sizes 12\u201327px and line heights 20\u201323px; fully authored flex/grid buttons with real text metrics, explicit UA overrides, borders, padding, inheritance and disabled geometry; supplemental contracts, not original WPT",
);
