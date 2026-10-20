import { compareCssContracts } from "./compare-css-contracts";
import { dynamicModulesFixture } from "./dynamic-modules-fixture";

await compareCssContracts(
  dynamicModulesFixture,
  "dynamic-modules",
  "tooling/dynamic-modules-fixture.ts",
  8,
  "64 fresh HTTP pages; runtime module URLs, concurrent imports, native namespace identity, top-level await, live exports, metadata and single execution",
);
