import { compareCssContracts } from "./compare-css-contracts";
import { windowNamedFixture } from "./window-named-fixture";
await compareCssContracts(
  windowNamedFixture,
  "window-named",
  "crates/engine/tests/fixtures/window-named.txt",
  34,
  "64 fresh pages over real HTTP; live named Window lookup through native document IDs and HTML named elements, duplicate live collections, namespaces, prototype descriptors and shadowing; default limits; no mocks; frames, independent documents and complete WindowProxy remain pending",
);
