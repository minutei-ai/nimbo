import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-animation-frame-sources.json";
await benchmarkWptCss(
  sources,
  "Twelve original automated animation-frame WPT HTML files; source bytes, harness and assertions unchanged; reporting-only adapter; real HTTP; real host clock; default limits; no mocks; cross-realm failures retained; the separately pinned manual cancellation file is not automated and remains unverified",
);
