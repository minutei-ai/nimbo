# Native attribute counts

`NamedNodeMap.length` reads the native element's attribute-vector length without
cloning attributes, allocating attribute handles or materializing JavaScript
`Attr` wrappers. It remains live and preserves the existing DOM operation charge.
Attribute lookup, enumeration, identity and attachment retain their current paths.

[Independent comparison](evidence/attribute-count-chromium.json) passed six
contracts in 64 Chromium and 64 Nimbo/celld pages: counts, identity, removal,
attachment, replacement and receiver validation. Native regressions verify that
512 repeated counts with 4,000 attributes allocate no new handles or write bytes.
Worker regressions cover 16,000 attributes with the default budgets.

[Three-round local A/B](evidence/attribute-count-memory-local.json) uses one fresh
isolate per build per round and the same real HTTP inputs and default limits.
Each round counts 1,000, 4,000 and 16,000 attributes, then returns to 1,000.
Retained Wasm linear capacity reaches 13,893,632 bytes in the baseline and
9,764,864 bytes in the candidate, consistently across the three rounds.
This is linear capacity, not allocator peak or total Worker memory. Recorded
latency includes parsing and HTTP; it does not establish production throughput.

The native debug build exceeded the default navigation deadline when constructing
the 16,000-attribute fragment used by the Worker regression. Its regression uses
4,000 attributes within the unchanged deadline. Attribute-heavy parser work,
attribute lookup/enumeration complexity and deep-tree traversal remain separate
roadmap work; this optimization adds no new quota or timeout allowance.
