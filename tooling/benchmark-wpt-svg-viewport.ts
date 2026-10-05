import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-svg-viewport-sources.json";
await benchmarkWptCss(
  sources,
  "Four original SVG WPT HTML files: animated lengths, non-rendered graphics geometry and bounding client rectangles, and image intrinsic sizing; original harness, Ahem font and PNG; source bytes and assertions unchanged; reporting-only adapter; real HTTP; default limits; no mocks; unsupported SVG APIs and rendering failures retained; separate from supplemental outer viewport checks",
);
