import { compareCssContracts } from "./compare-css-contracts";
import { frameworkFixture } from "./framework-fixture";
await compareCssContracts(
  frameworkFixture,
  "frameworks",
  "crates/engine/tests/fixtures/frameworks/app.txt",
  14,
  "64 fresh HTTP pages per framework; unmodified pinned Preact/Vue modules execute in owned QuickJS; preserve server DOM identity, update state through real events, reorder keyed lists, fetch data and unmount; default limits",
  [
    { route: "frameworks/preact", expectedCount: 14 },
    { route: "frameworks/vue", expectedCount: 14 },
  ],
);
