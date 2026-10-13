import { compareCssContracts } from "./compare-css-contracts";
import { largeDomFixture } from "./large-dom-fixture";

await compareCssContracts(
  largeDomFixture,
  "large-dom/live-children",
  "crates/engine/tests/fixtures/large-dom.txt",
  8,
  "64 fresh 5000-element HTTP pages; live child counts, lazy indexed identity and text/element mutations; default budgets",
  undefined,
  "largeLiveChildrenCase()",
);
