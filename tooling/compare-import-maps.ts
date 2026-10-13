import { compareCssContracts } from "./compare-css-contracts";
import { importMapFixture } from "./import-map-fixture";
await compareCssContracts(
  importMapFixture,
  "import-maps",
  "tooling/import-map-fixture.ts",
  6,
  "64 fresh HTTP pages; parser-time import maps, scoped aliases, prefix resolution, cyclic live exports, cached dynamic imports, null blocking and prefix escape rejection; default limits",
);
