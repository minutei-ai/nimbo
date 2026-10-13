import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/dom-arena.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/dom-arena/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html" },
        })
      : undefined,
  "dom-arena",
  fixture,
  8,
  "64 fresh HTTP pages; native fragment recovery, detached references, UTF-8, namespaces, templates and Shadow DOM; default budgets",
  undefined,
  "fragmentCase()",
);
