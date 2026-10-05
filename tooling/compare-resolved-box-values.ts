import { compareCssContracts } from "./compare-css-contracts";
import { resolvedBoxValuesFixture } from "./resolved-box-values-fixture";
await compareCssContracts(
  resolvedBoxValuesFixture,
  "resolved-box-values",
  "crates/engine/tests/fixtures/resolved-box-values.txt",
  37,
  "64 fresh pages per runtime over real HTTP; used dimensions, box sizing, constraints, spacing, auto margins, percentages, aliases, cascade and live CSSOM; default limits; no mocks; separate from original WPT",
);
