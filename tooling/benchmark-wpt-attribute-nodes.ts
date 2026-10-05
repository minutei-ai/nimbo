import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-attribute-nodes-sources.json";
await benchmarkWptCss(
  sources,
  "Four original Attr/NamedNodeMap WPT HTML files with original harness and helpers; immutable source bytes and assertions; reporting-only adapter; real HTTP; default limits; no mocks; independent XML documents and other original failures retained",
);
