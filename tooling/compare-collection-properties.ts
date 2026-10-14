import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/collection-properties.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/collection-properties/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html" },
        })
      : undefined,
  "collection-properties",
  fixture,
  38,
  "64 fresh HTTP pages; observable collection lengths, inherited unsupported indices, changed prototypes, iterator completion and forEach snapshot semantics; original budgets",
  undefined,
  "collectionPropertiesCase()",
);
