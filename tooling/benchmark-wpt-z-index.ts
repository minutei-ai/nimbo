import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-z-index-sources.json";
await benchmarkWptCss(
  sources,
  "Three original z-index parsing/computed HTML files, original helpers and testharness; original vendor integration script plus reporting-only append; output/message events disabled; real HTTP; default engine limits; no mocks",
);
