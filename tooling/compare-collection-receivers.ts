import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/collection-receivers.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/collection-receivers/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html" },
        })
      : undefined,
  "collection-receivers",
  fixture,
  86,
  "64 fresh HTTP pages; collection native receiver brands, inherited option collections, prototype changes, generic array-like iteration and captured native intrinsics; original budgets",
  undefined,
  "collectionReceiversCase(Number(location.pathname.split('/').pop()))",
);
