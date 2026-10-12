import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/pre-line.txt";
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
    const match = /^\/pre-line\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(match[1])};globalThis.contractFontFamily='ContractMono';globalThis.comparison=(async()=>{const face=new FontFace('ContractMono','url(/public-font-assets/LiberationMono-Regular.ttf)');document.fonts.add(face);await face.load();${source};return globalThis.comparison;})();</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "pre-line",
  fixturePath,
  12,
  "64 fresh HTTP pages per runtime; preserved segment breaks with collapsed spaces, leading and trailing breaks, blank lines, CRLF, wrapping, inheritance, clamping and mutation; original supplemental fixture, not original WPT",
);
