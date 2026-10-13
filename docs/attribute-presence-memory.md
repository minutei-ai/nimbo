# Attribute presence without value transfer

`Element.hasAttribute()` and `hasAttributeNS()` return native booleans. The Rust
bridge checks borrowed attribute names/namespaces without copying values into
Rust strings, JSON strings or JavaScript strings. Input/textarea boolean
reflection, `defaultChecked` and `HTMLElement.inert` use the same presence path.
Qualified-name matching retains HTML normalization; namespace/local-name lookup
retains exact case. Existing receiver and argument conversions stay in the owned
JavaScript interfaces. Value-reading APIs still return their values.

Native selector ID/class comparisons also inspect borrowed null-namespace
values, preserving case sensitivity and the existing HTML-space tokenization.
Link selectors test href presence without copying its value. A local large-class
probe returned the same results and retained Wasm capacity in both builds;
removing these temporary copies does not establish a retained-capacity reduction.

[Independent comparison](evidence/attribute-presence-chromium.json) passed
24 contracts across 64 Chromium and 64 Nimbo/celld pages at default limits.
Contracts cover empty/missing/large values, HTML/XML/SVG names, namespace
exclusion, prefix retention, adoption, attached Attr changes, boolean reflection,
argument conversion, receivers and descriptors. Native HTTP and Worker regressions
also cover these contracts and fresh-page state.

Full validation passed 8,156 Bun tests and 207 native tests in each debug/release
profile, plus formatting, strict TypeScript/Rust/Wasm lint and Rust documentation.

[Three-round local memory evidence](evidence/attribute-presence-memory-local.json)
uses one isolate per build per round. Each page has one button whose disabled
attribute contains 65,536, 524,288, 900,000, 900,000 and 65,536 ASCII characters,
respectively. Each extraction performs 50 paired presence checks. All 30
extractions returned true with the unchanged default budgets.

In every round, baseline capacity after the largest request was 14,942,208 bytes
(14.25 MiB); candidate capacity was 9,764,864 bytes (9.3125 MiB), 34.65% lower.
Repeated large requests and the final small request did not grow either build.
Capacity does not shrink on page disposal. These samples measure retained Wasm
linear capacity, not live allocation, allocator peak or total Worker memory.
They do not establish a latency improvement or production capacity.

The local probe retains `initSync({ module: wasm }).memory` in an instrumented
bundle and samples `memory.buffer.byteLength` between extractions. It uses
`CELLD_MAX_STATELESS_ISOLATES=1`; the measurement route is outside the deployed
handler. Reports identify the exact Wasm artifacts and synthetic workload.

The contracts follow the public [DOM attribute lookup methods](https://dom.spec.whatwg.org/#dom-element-hasattribute)
and [HTML reflection model](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes).
