import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/collection-names.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/collection-names/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html" },
        })
      : undefined,
  "collection-names",
  fixture,
  19,
  "64 fresh HTTP pages; native selected option named lookup, identity, filters, duplicate ordering, borrowed methods and DOMString conversion before live resolution; original limits",
  undefined,
  "collectionNamesCase(Number(location.pathname.split('/').pop()))",
  {
    order:
      "Chrome 155 returns a later ID match before an earlier name match; DOM namedItem requires the first match in collection order: https://dom.spec.whatwg.org/#dom-htmlcollection-nameditem",
  },
);
