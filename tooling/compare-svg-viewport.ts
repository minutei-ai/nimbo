import { compareCssContracts } from "./compare-css-contracts";
import { svgViewportFixture } from "./svg-viewport-fixture";
await compareCssContracts(
  svgViewportFixture,
  "svg-viewport",
  "crates/engine/tests/fixtures/svg-viewport.txt",
  39,
  "64 fresh pages per runtime over real HTTP; outer SVG viewport dimensions, native intrinsic sizing, viewBox ratio, attributes, CSS, constraints and live mutation; internal SVG graphics and painting excluded; default limits; no mocks; separate from original WPT",
);
