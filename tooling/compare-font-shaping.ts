import { join } from "node:path";
import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/font-shaping.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
const font = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/synthetic-shaping-font.ttf"),
).arrayBuffer();
await compareCssContracts(
  (path) => {
    if (path.startsWith("/font-shaping-assets/"))
      return new Response(font, { headers: { "content-type": "font/ttf" } });
    const match = /^\/font-shaping\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "font-shaping",
  fixturePath,
  27,
  "64 fresh pages over real HTTP; loaded synthetic TrueType fonts with actual OpenType GSUB ligatures and GPOS kerning, canvas width, binary sources, branding and font state; native Wasm in celld versus ordinary Chromium, width tolerance 0.001 CSS px; supplemental contracts, not original WPT",
);
