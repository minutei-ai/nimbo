import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/mouse-events.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/mouse-events/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "mouse-events",
  fixture,
  46,
  "64 fresh HTTP pages; owned UI/mouse/pointer event constructors, fields, brands, coercion, sequences and receivers; default budgets",
  undefined,
  "mouseEventsCase(Number(location.pathname.split('/').pop()))",
);
