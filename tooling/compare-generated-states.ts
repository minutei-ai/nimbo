import { compareCssContracts } from "./compare-css-contracts";
import { generatedStatesFixture } from "./generated-states-fixture";

await compareCssContracts(
  generatedStatesFixture,
  "generated-states",
  "tooling/generated-states-fixture.ts",
  16,
  "64 fresh HTTP pages; generated pseudo-element states, origin specificity, index predicates and native checked-state mutations; default limits",
);
