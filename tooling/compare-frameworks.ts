import { compareCssContracts } from "./compare-css-contracts";
import { frameworkFixture } from "./framework-fixture";
await compareCssContracts(
  frameworkFixture,
  "frameworks",
  "crates/engine/tests/fixtures/frameworks/app.txt",
  20,
  "64 fresh HTTP pages per framework; unmodified pinned Preact/Vue modules execute in owned QuickJS; preserve server DOM identity, update state through real events, reorder keyed lists, fetch data, navigate/back/forward through History and unmount; default limits",
  [
    { route: "frameworks/preact", expectedCount: 20 },
    { route: "frameworks/vue", expectedCount: 20 },
  ],
);
