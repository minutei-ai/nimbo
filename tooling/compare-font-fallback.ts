import { join } from "node:path";
import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/font-fallback.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
const fixtures = join(import.meta.dir, "../crates/engine/tests/fixtures");
const fonts = {
  latin: await Bun.file(join(fixtures, "synthetic-shaping-font.ttf")).arrayBuffer(),
  scripts: await Bun.file(join(fixtures, "synthetic-scripts-font.ttf")).arrayBuffer(),
};
await compareCssContracts(
  (path) => {
    const asset = /^\/font-fallback-assets\/(latin|scripts)\/\d+$/.exec(path);
    if (asset)
      return new Response(asset[1] === "latin" ? fonts.latin : fonts.scripts, {
        headers: { "content-type": "font/ttf" },
      });
    const match = /^\/font-fallback\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "font-fallback",
  fixturePath,
  8,
  "64 fresh pages over real HTTP; per-character fallback across a loaded font-family list and unicode-range subsets of one family, with Arabic joining and Latin ligatures/kerning inside fallback runs and a family mutation; inline-block widths, tolerance 3/64 px for per-fragment layout-unit rounding; supplemental contracts, not original WPT",
);
