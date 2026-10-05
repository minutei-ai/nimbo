import { compareCssContracts } from "./compare-css-contracts";
import { animationFramesFixture } from "./animation-frames-fixture";
await compareCssContracts(
  animationFramesFixture,
  "animation-frames",
  "crates/engine/tests/fixtures/animation-frames.txt",
  32,
  "64 fresh pages over real HTTP; independent animation handles, callback snapshots, cancellation during microtasks, same-frame timestamps, nested frames, exceptions and live DOM; real host clock; default limits; no mocks; supplemental contracts, not painting or multi-realm conformance",
);
