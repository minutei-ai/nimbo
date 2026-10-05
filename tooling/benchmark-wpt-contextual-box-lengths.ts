import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-contextual-box-lengths-sources.json";
await benchmarkWptCss(
  sources,
  "Eleven original WPT HTML files: absolute/font/root-rem/viewport units and six invalid width/height/min/max sizing files; original testharness and parsing helper; source bytes and assertions unchanged; reporting-only adapter; real HTTP; default limits; no mocks; computed-style gaps and frame failures retained; separate from supplemental geometry checks",
);
