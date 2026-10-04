import { compareCssContracts } from "./compare-css-contracts";
import { transitionsFixture } from "./transitions-fixture";
await compareCssContracts(
  transitionsFixture,
  "transitions",
  "crates/engine/tests/fixtures/transitions.txt",
  25,
  "64 fresh pages per runtime over real HTTP; 25 supplemental contracts per page; default limits; no mocks; separate from original WPT",
);
