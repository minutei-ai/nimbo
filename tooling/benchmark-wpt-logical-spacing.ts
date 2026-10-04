import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-logical-spacing-sources.json";
await benchmarkWptCss(
  sources,
  "Sixteen original logical margin/padding/inset and physical inset parsing, computed and shorthand HTML files, original helpers and testharness; original vendor reporting plus reporting-only append; assertions unchanged; real HTTP; default engine limits; no mocks; unsupported computed values remain failures",
);
