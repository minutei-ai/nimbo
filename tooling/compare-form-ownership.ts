import { compareCssContracts } from "./compare-css-contracts";
const fixture = "crates/engine/tests/fixtures/form-ownership.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/form-ownership/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "form-ownership",
  fixture,
  23,
  "64 fresh HTTP pages; owned form association, explicit IDs, mutations, disconnected trees, nested forms, Shadow DOM and interface brands; default budgets",
  undefined,
  "formOwnershipCase(Number(location.pathname.split('/').pop()))",
);
