import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/latin-punctuation.txt";
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
    const match = /^\/latin-punctuation\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};globalThis.contractFontFamily='ContractMono';globalThis.comparison=(async()=>{const face=new FontFace('ContractMono','url(/public-font-assets/LiberationMono-Regular.ttf)');document.fonts.add(face);await face.load();${source};return globalThis.comparison;})();</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "latin-punctuation",
  fixturePath,
  6,
  "64 fresh HTTP pages per runtime; Latin text with Unicode common punctuation, typographic quotes, dashes, ellipsis and neutral symbols using matching monospace fonts; original supplemental fixture, not original WPT",
);
