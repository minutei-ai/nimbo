import { compareCssContracts } from "./compare-css-contracts";
import { stickyGeometryFixture } from "./sticky-geometry-fixture";
await compareCssContracts(
  stickyGeometryFixture,
  "sticky-geometry",
  "crates/engine/tests/fixtures/sticky-geometry.txt",
  28,
  "64 fresh pages per runtime over real HTTP; 28 supplemental contracts per page; default limits; no mocks; separate from original WPT",
);
