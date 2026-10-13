import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/form-reset.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/form-reset/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "form-reset",
  fixture,
  26,
  "64 fresh HTTP pages; owned text and checkedness reset, native radio groups, event flags/cancellation/reentrancy, listener mutations and form ownership; default budgets",
  undefined,
  "formResetCase(Number(location.pathname.split('/').pop()))",
);
