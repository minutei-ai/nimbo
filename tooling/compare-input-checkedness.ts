import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/input-checkedness.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/input-checkedness/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "input-checkedness",
  fixture,
  50,
  "64 fresh HTTP pages; owned checkedness, dirty flags, default reflection, radio roots/names/forms and mutation records; default budgets",
  undefined,
  "inputCheckednessCase(Number(location.pathname.split('/').pop()))",
);
