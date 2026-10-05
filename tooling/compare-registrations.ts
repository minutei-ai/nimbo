import { compareCssContracts } from "./compare-css-contracts";

const fixturePath = "crates/engine/tests/fixtures/registrations.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/registrations\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><html><head></head><body><script>globalThis.variant=${Number(match[1])};${source}</script></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "registrations",
  fixturePath,
  77,
  "64 fresh pages over real HTTP; registered CSS defaults, inheritance, typed substitution and paused keyframe interpolation; actual native Wasm in celld and ordinary Chromium; no mocks; supplemental contracts, not original WPT",
);
