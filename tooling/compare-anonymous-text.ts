import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/anonymous-text.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/anonymous-text\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "anonymous-text",
  fixturePath,
  9,
  "64 distinct fresh HTTP pages per runtime; font sizes 12\u201327px and line heights 20\u201323px; native anonymous flex/grid text, whitespace, hidden elements, CSS order and mutations; supplemental contracts, not original WPT",
);
