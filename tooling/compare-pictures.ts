import { compareCssContracts } from "./compare-css-contracts";
import { pictureFixture } from "./picture-fixture";
await compareCssContracts(
  pictureFixture,
  "pictures",
  "tooling/picture-fixture.ts",
  16,
  "64 fresh HTTP pages; picture fallback, source order, media, type, density and source mutations; default limits",
);
