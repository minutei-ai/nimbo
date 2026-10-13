import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/attribute-count.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/attribute-count/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html" },
        })
      : undefined,
  "attribute-count",
  fixture,
  6,
  "64 fresh HTTP pages; live NamedNodeMap counts, attribute identity, removal, attachment, replacement and receiver checks; default budgets",
  undefined,
  "attributeCountCase(Number(location.pathname.split('/').pop()))",
);
