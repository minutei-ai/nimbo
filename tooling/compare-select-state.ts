import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/select-state.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/select-state/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "select-state",
  fixture,
  72,
  "64 fresh HTTP pages; native select selectedness, defaults, dirty state, mutations, live collections, indexed access, option factory and transactional owned reset; default budgets",
  undefined,
  "selectStateCase(Number(location.pathname.split('/').pop()))",
);
