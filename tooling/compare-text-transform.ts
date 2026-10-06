import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/text-transform.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/text-transform\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "text-transform",
  fixturePath,
  13,
  "64 distinct fresh HTTP pages per runtime; Unicode casing, language inheritance, source preservation, computed styles, wrapping, spacing and mutations; supplemental fixture, not original WPT",
);
