import { compareCssContracts } from "./compare-css-contracts";
import { documentStylesheetsFixture } from "./document-stylesheets-fixture";
await compareCssContracts(
  documentStylesheetsFixture,
  "document-stylesheets",
  "crates/engine/tests/fixtures/document-stylesheets.txt",
  25,
  "64 fresh pages over real HTTP; document stylesheet list, loaded link ownership, indexed live collections, grouped sheet association, native CSSOM mutation and disabled cascade; default limits; no mocks; imports, grouping CSSOM and owner lifecycle remain incomplete",
);
