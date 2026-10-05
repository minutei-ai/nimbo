import { join } from "node:path";
import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/font-profile.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const font =
      /^\/public-font-assets\/(Liberation(?:Serif|Sans|Mono)-(?:Regular|Bold|Italic|BoldItalic)\.ttf)$/.exec(
        path,
      );
    if (font?.[1])
      return new Response(
        Bun.file(join(import.meta.dir, "../target/font-reference/profile", font[1])),
        { headers: { "content-type": "font/ttf" } },
      );
    const match = /^\/font-profile\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "font-profile",
  fixturePath,
  14,
  "64 fresh pages; actual public Liberation 2.1.5 files, generic serif/sans/mono profiles, real regular/bold/italic faces, normal line metrics, positive and negative letter spacing, registry removal; identical assertions in celld and ordinary Chromium, tolerance 1/64 CSS px",
);
