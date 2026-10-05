import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-document-stylesheets-sources.json";
await benchmarkWptCss(
  sources,
  "Three original StyleSheetList WPT HTML files: indexed live collection, item, wrapper identity and exclusion of adopted stylesheets before and after style recalculation; original source bytes and assertions unchanged; reporting-only adapter; real HTTP; default limits; no mocks; not full CSSOM conformance",
);
