import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/text-controls.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/text-controls/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "text-controls",
  fixture,
  38,
  "64 fresh HTTP pages; owned input/textarea values, dirty defaults, UTF-16, newline sanitization, string/boolean reflection, brands, receivers and detached identity; default budgets",
  undefined,
  "textControlsCase(Number(location.pathname.split('/').pop()))",
);
