import { compareCssContracts } from "./compare-css-contracts";
import { attributeNamespacesFixture } from "./attribute-namespaces-fixture";
await compareCssContracts(
  attributeNamespacesFixture,
  "attribute-namespaces",
  "crates/engine/tests/fixtures/attribute-namespaces.txt",
  42,
  "64 fresh pages over real HTTP; native namespaced and qualified attributes, null-namespace ID/class/style reflection, selector and cascade isolation, SVG serialization, Web IDL errors and custom element reactions; default limits; no mocks; complete Attr/NamedNodeMap remain pending",
);
