import { compareCssContracts } from "./compare-css-contracts";
import { largeDomFixture } from "./large-dom-fixture";

await compareCssContracts(
  largeDomFixture,
  "large-dom/iteration",
  "crates/engine/tests/fixtures/large-dom.txt",
  11,
  "64 fresh HTTP pages; default-budget iteration, live indices after callbacks/mutations, static snapshots, attributes, shadow and XML roots",
  undefined,
  "collectionIterationCase()",
);
