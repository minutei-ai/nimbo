import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/control-selectors.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/control-selectors/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "control-selectors",
  fixture,
  44,
  "64 fresh HTTP pages; live native control selectors, CSS invalidation, radio indeterminacy, fieldsets and scoped queries; default budgets",
  undefined,
  "controlSelectorsCase(Number(location.pathname.split('/').pop()))",
);
