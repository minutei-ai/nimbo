import { compareCssContracts } from "./compare-css-contracts";
const fixturePath = "crates/engine/tests/fixtures/stealth.txt";
const source = await Bun.file(new URL(`../${fixturePath}`, import.meta.url)).text();
await compareCssContracts(
  (path) => {
    const match = /^\/stealth\/(\d+)$/.exec(path);
    if (!match) return undefined;
    return new Response(
      `<!doctype html><body><script>globalThis.variant=${Number(match[1])};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
  "stealth",
  fixturePath,
  22,
  "64 fresh HTTP pages per runtime; Navigator descriptors/brand, language consistency, global isolation, owned API receiver checks and visible automation artifacts; synthetic contracts, not an anti-bot challenge pass",
);
