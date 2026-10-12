import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/inline-text.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/inline-text\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "inline-text",
  fixturePath,
  5,
  "64 fresh HTTP pages per runtime; same-font inline text, words, kerning, nested wrappers and collapsed spaces under an authored reset; inline fragment rejection is tested separately in the native engine",
  undefined,
  "Promise.resolve(globalThis.comparison).then(checks=>{delete checks.fragmentBoundary;return checks;})",
);
