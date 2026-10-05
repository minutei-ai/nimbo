import { compareCssContracts } from "./compare-css-contracts";
import { scriptModesFixture, scriptModesExpression } from "./script-modes-fixture";
await compareCssContracts(
  scriptModesFixture,
  "script-modes",
  "crates/engine/tests/fixtures/script-modes.txt",
  37,
  "64 fresh pages over real HTTP; classic inline/external scripts and extraction expressions derive strict mode from their directive prologues; modules remain strict; eval, arguments aliasing, this binding, property assignment, syntax and imports; default limits; no mocks; supplemental contracts, not the full ECMAScript conformance suite",
  [{ route: "script-modes", expectedCount: 37 }],
  scriptModesExpression,
);
