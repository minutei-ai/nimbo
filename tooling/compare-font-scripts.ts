import { join } from "node:path";
import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/font-scripts.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
const font = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/synthetic-scripts-font.ttf"),
).arrayBuffer();
await compareCssContracts(
  (path) => {
    if (path.startsWith("/font-scripts-assets/"))
      return new Response(font, { headers: { "content-type": "font/ttf" } });
    const match = /^\/font-scripts\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "font-scripts",
  fixturePath,
  18,
  "64 fresh pages over real HTTP; one loaded synthetic font covering Latin, Greek, Cyrillic, Hebrew and Arabic with script-scoped Arabic joining and Latin kerning; canvas and inline-block widths over mixed-direction and mixed-script text; canvas width tolerance 0.001 CSS px, box width 2/64 px for per-fragment layout-unit rounding; supplemental contracts, not original WPT",
);
