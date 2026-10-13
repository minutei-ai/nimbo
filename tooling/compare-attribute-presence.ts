import { compareCssContracts } from "./compare-css-contracts";

const fixture = "crates/engine/tests/fixtures/attribute-presence.txt";
const source = await Bun.file(new URL(`../${fixture}`, import.meta.url)).text();
await compareCssContracts(
  (path) =>
    path.startsWith("/attribute-presence/")
      ? new Response(`<!doctype html><body><script>${source}</script>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      : undefined,
  "attribute-presence",
  fixture,
  24,
  "64 fresh HTTP pages; qualified/namespace presence, boolean reflection, XML/SVG case, adoption, attached Attr mutations and receiver/conversion checks; default budgets",
  undefined,
  "attributePresenceCase(Number(location.pathname.split('/').pop()))",
);
