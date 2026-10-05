import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-cssom-owner-sources.json";
await benchmarkWptCss(
  sources,
  "Four original CSSOM WPT HTML files: replacement, live rules, detached rule ownership, parse recovery and document-owned replacement rejection; original harness and import stylesheet; source bytes and assertions unchanged; reporting-only adapter; real HTTP; default limits; no mocks; grouping and import failures retained; document stylesheet list is implemented; the separately pinned shadow DOM reftest is not automated and remains unverified",
);
