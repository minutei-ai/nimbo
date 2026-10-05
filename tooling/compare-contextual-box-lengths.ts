import { compareCssContracts } from "./compare-css-contracts";
import { contextualBoxLengthsFixture } from "./contextual-box-lengths-fixture";
await compareCssContracts(
  contextualBoxLengthsFixture,
  "contextual-box-lengths",
  "crates/engine/tests/fixtures/contextual-box-lengths.txt",
  50,
  "64 fresh pages per runtime over real HTTP; inherited font and viewport box lengths, calculations, ranges, aliases, generated boxes and sticky geometry; default limits; no mocks; separate from original WPT",
);
