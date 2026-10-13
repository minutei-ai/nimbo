import { compareCssContracts } from "./compare-css-contracts";
import { frameworkFixture } from "./framework-fixture";
await compareCssContracts(
  frameworkFixture,
  "frameworks/dom-primitives",
  "crates/engine/tests/fixtures/frameworks/dom-primitives.txt",
  24,
  "64 fresh HTTP pages; owned child presence and callable event handler properties, cancellation, receiver checks, listener position and non-callable object conversion; default limits",
);
