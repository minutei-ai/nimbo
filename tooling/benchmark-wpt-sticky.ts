import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-sticky-sources.json";
await benchmarkWptCss(
  sources,
  "Four original CSS sticky HTML files, helper and testharness; original vendor integration script plus reporting-only append; output/message events disabled; real HTTP; default engine limits; no mocks",
);
