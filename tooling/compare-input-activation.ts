import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/input-activation.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/input-activation/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "input-activation",
  fixture,
  36,
  "64 fresh HTTP pages; owned control click activation, rollback, radio groups, disabled fieldsets and event delivery; default budgets",
  undefined,
  "inputActivationCase(Number(location.pathname.split('/').pop()))",
);
