import { compareCssContracts } from "./compare-css-contracts";
import { domImplementationFixture } from "./dom-implementation-fixture";

await compareCssContracts(
  domImplementationFixture,
  "dom-implementation",
  "crates/engine/tests/fixtures/dom-implementation-has-feature.txt",
  16,
  "64 fresh HTTP pages; historical hasFeature, ignored arguments, native Web IDL reflection, document ownership and invalid receivers",
);
