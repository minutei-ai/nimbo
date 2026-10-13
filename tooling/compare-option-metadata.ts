import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/option-metadata.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/option-metadata/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "option-metadata",
  fixture,
  45,
  "64 fresh HTTP pages; native option text/value/label, ASCII space normalization, script exclusion, live option index and form ownership, option barriers, namespaces and interface contracts; default budgets",
  undefined,
  "optionMetadataCase(Number(location.pathname.split('/').pop()))",
);
