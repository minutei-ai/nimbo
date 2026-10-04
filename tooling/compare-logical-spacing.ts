import { compareCssContracts } from "./compare-css-contracts";
import { logicalSpacingFixture } from "./logical-spacing-fixture";
await compareCssContracts(
  logicalSpacingFixture,
  "logical-spacing",
  "crates/engine/tests/fixtures/logical-spacing.txt",
  45,
  "Two scenarios with 64 fresh pages each per runtime over real HTTP; 45 geometry/cascade/CSSOM and 11 real-clock logical transition contracts per pair of pages; default limits; no mocks; separate from original WPT",
  [
    { route: "logical-spacing", expectedCount: 45 },
    { route: "logical-spacing-transitions", expectedCount: 11 },
  ],
);
