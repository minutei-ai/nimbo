import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/authored-inputs.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/authored-inputs\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "authored-inputs",
  fixturePath,
  5,
  "64 fresh HTTP pages per runtime; fully authored text controls with flex allocation and zero automatic minimum, fixed-size toggles; original supplemental fixture, not original WPT",
);
