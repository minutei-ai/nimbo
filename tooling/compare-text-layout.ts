import { join } from "node:path";
import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/text-layout.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
const font = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/synthetic-shaping-font.ttf"),
).arrayBuffer();
await compareCssContracts(
  (path) => {
    if (path.startsWith("/font-shaping-assets/"))
      return new Response(font, { headers: { "content-type": "font/ttf" } });
    const match = /^\/text-layout\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "text-layout",
  fixturePath,
  12,
  "64 fresh pages over real HTTP; loaded synthetic TrueType fonts, DOM block text geometry, GSUB ligatures, GPOS kerning, canonical composition, whitespace collapse, line wrapping and mutation; native Wasm in celld versus ordinary Chromium, tolerance one Chromium layout unit (1/64 CSS px); supplemental contracts, not original WPT",
);
