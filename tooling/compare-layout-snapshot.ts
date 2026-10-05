import { compareCssContracts } from "./compare-css-contracts";
import { layoutSnapshotFixture } from "./layout-snapshot-fixture";
await compareCssContracts(
  layoutSnapshotFixture,
  "layout-snapshot",
  "crates/engine/tests/fixtures/layout-snapshot.txt",
  30,
  "64 fresh pages over real HTTP; geometry reads after scrolling, clamping, stylesheet and CSSOM mutation, selector replacement, adoption, attributes, inline styles, ancestor sizing, reparenting, detachment and display changes; default limits; no mocks; supplemental geometry contracts, not full rendering conformance",
);
