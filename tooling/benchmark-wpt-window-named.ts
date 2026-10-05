import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-window-named-sources.json";
await benchmarkWptCss(
  sources,
  "All 17 standalone HTML tests from the original named Window access folder, with original harness and helper resources; immutable source bytes and assertions; reporting-only adapter; real HTTP; default limits; no mocks; frame and independent-document failures retained; the multi-origin sub-template and generated window-JS test are separately pinned and remain unverified",
);
