import { compareCssContracts } from "./compare-css-contracts";
import { mutationObserverFixture } from "./mutation-observer-fixture";
await compareCssContracts(
  mutationObserverFixture,
  "mutation-observer",
  "crates/engine/tests/fixtures/mutation-observer.txt",
  40,
  "64 fresh HTTP pages; owned native mutation records, filtering, static lists, detached transients, ordered microtasks and shadow isolation; default limits",
);
