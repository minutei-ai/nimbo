import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/inline-block.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    if (path === "/public-font-assets/LiberationMono-Regular.ttf")
      return new Response(
        Bun.file(
          new URL("../target/font-reference/profile/LiberationMono-Regular.ttf", import.meta.url),
        ),
        { headers: { "content-type": "font/ttf" } },
      );
    const match = /^\/inline-block\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};globalThis.contractFontFamily='ContractMono';globalThis.comparison=(async()=>{const face=new FontFace('ContractMono','url(/public-font-assets/LiberationMono-Regular.ttf)');document.fonts.add(face);await face.load();${source};return globalThis.comparison;})();</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "inline-block",
  fixturePath,
  8,
  "64 fresh HTTP pages per runtime; atomic inline blocks, adjacent boxes, wrapping, mixed font metrics, last-line baselines, translation and mutation with a shared public font; original supplemental fixture, not original WPT",
);
