import { compareCssContracts } from "./compare-css-contracts";
import { htmlElementInterfacesFixture } from "./html-element-interfaces-fixture";

await compareCssContracts(
  htmlElementInterfacesFixture,
  "html-element-interfaces",
  "crates/engine/tests/fixtures/html-element-interfaces.txt",
  35,
  "64 fresh HTTP pages; native element prototypes, HTML namespace identity, invalid receivers and content attribute reflection",
);
