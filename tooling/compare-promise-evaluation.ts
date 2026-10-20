import { compareCssContracts } from "./compare-css-contracts";
import { promiseEvaluationFixture } from "./promise-evaluation-fixture";

await compareCssContracts(
  promiseEvaluationFixture,
  "promise-evaluation/global",
  "crates/engine/tests/fixtures/promise-evaluation.txt",
  8,
  "64 fresh HTTP pages per scenario; page-owned Promise constructor and prototype replacements, thenable adoption, fulfillment and rejection",
  [
    { route: "promise-evaluation/global", expectedCount: 8 },
    { route: "promise-evaluation/then", expectedCount: 8 },
  ],
);
