import { compareCssContracts } from "./compare-css-contracts";
import { pictureFixture } from "./picture-fixture";
await compareCssContracts(
  pictureFixture,
  "pictures",
  "tooling/picture-fixture.ts",
  16,
  "64 fresh HTTP pages; picture fallback, source order, media, type, density and source mutations; default limits",
  undefined,
  undefined,
  {
    emptyType:
      "Pinned Chromium treats an explicit empty source type as no hint. The HTML source-set algorithm skips that unknown MIME type; Nimbo selects the image fallback.",
  },
);
