import { benchmarkWptCss } from "./benchmark-wpt-css";
import sources from "./wpt-attribute-namespaces-sources.json";
await benchmarkWptCss(
  sources,
  "Eight original attribute WPT HTML files, original harness and helper scripts; immutable source bytes and assertions; reporting-only adapter; real HTTP; default limits; no mocks; native Attr and NamedNodeMap; independent documents and other original failures retained",
);
