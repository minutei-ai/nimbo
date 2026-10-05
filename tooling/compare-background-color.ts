import { compareCssContracts } from "./compare-css-contracts";
import { backgroundColorFixture } from "./background-color-fixture";
await compareCssContracts(
  backgroundColorFixture,
  "background-color",
  "crates/engine/tests/fixtures/background-color.txt",
  24,
  "64 fresh pages per runtime; native cascade, transparency, currentColor, inheritance, shorthand reset, variables, live CSSOM and reparenting; real HTTP; default limits; no mocks; original WPT tracked separately; no painting claim",
);
