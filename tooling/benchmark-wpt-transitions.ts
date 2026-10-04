import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-transitions-sources.json";
await benchmarkWptCss(
  sources,
  "Seventeen original CSS transition parsing/computed/shorthand HTML files, original helpers and testharness; original vendor integration script plus reporting-only append; output/message events disabled; real HTTP; default engine limits; no mocks; unsupported Level 2 behavior remains in the results",
);
