import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/input-value-modes.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/input-value-modes/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "input-value-modes",
  fixture,
  44,
  "64 fresh HTTP pages; native default/default-on values, sanitization transfers, dirty-flag reset, type attributes and mutation records; default budgets",
  undefined,
  "inputValueModesCase(Number(location.pathname.split('/').pop()))",
);
