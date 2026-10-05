import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/font-settings.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/font-settings\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "font-settings",
  fixturePath,
  12,
  "64 distinct fresh HTTP pages per runtime; feature indices 0\u201363, variation weights 100\u2013730 and negative fractional slants; native CSSOM validation and serialization; nondefault shaping remains unsupported; supplemental contracts, not original WPT",
);
