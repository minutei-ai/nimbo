import { compareCssContracts } from "./compare-css-contracts";
import { zIndexFixture } from "./z-index-fixture";
await compareCssContracts(
  zIndexFixture,
  "z-index",
  "crates/engine/tests/fixtures/z-index.txt",
  39,
  "64 fresh pages per runtime over real HTTP; 39 supplemental contracts per page; default limits; no mocks; separate from original WPT",
);
