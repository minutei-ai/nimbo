import { compareCssContracts } from "./compare-css-contracts";
import { historyFixture } from "./history-fixture";
await compareCssContracts(
  historyFixture,
  "history",
  "crates/engine/tests/fixtures/history.txt",
  35,
  "64 fresh HTTP pages; owned same-document history, cloned state graphs, trusted traversal events, frozen base/style URLs, relative fetch and cookie scope; default limits",
);
