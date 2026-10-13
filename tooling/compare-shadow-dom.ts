import { compareCssContracts } from "./compare-css-contracts";
import { shadowDomFixture } from "./shadow-dom-fixture";
await compareCssContracts(
  shadowDomFixture,
  "shadow-dom",
  "crates/engine/tests/fixtures/shadow-dom.txt",
  57,
  "64 fresh pages over real HTTP; owned open/closed roots, queries, connection, named slots, composed events and lifecycle; extraction subset; default limits",
);
