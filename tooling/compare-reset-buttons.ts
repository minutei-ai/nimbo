import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/reset-buttons.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/reset-buttons/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "reset-buttons",
  fixture,
  42,
  "64 fresh HTTP pages; native reset activation, buttons and reset inputs, disabled/cancelled dispatch, listener mutations, nested paths, event cleanup and button interface contracts; default budgets",
  undefined,
  "resetButtonsCase(Number(location.pathname.split('/').pop()))",
);
