import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-background-color-sources.json";
await benchmarkWptCss(
  sources,
  "Three unchanged original background-color WPT files covering valid and invalid declarations and computed values; original harness and common helpers; reporting-only adapter; real HTTP; default limits; no mocks; unsupported failures retained; no painting claim",
);
