# Observable collection iteration

NodeList iteration and `forEach`, HTMLCollection iteration and NamedNodeMap
iteration use the owned QuickJS Array methods with an iteration-local view.
The view reuses native identifiers until the mutation version changes. It reads
observable length properties and delegates unsupported indices to the original
collection, including inherited properties after a prototype change.

The temporary Proxy has an empty ordinary target. Using the collection itself
as its target would make QuickJS check the collection's indexed descriptors on
every access, causing repeated native enumeration. The view is never exposed to
page callbacks: `forEach` supplies the original collection as its third argument.
The identifiers read by length or a supported-index presence check are reused
for the immediately following index access within the native Array operation.
This avoids a second version query; custom length getters and inherited-index
lookups refresh native state. No persistent identifier cache, copied DOM or
new runtime dependency is added.

The native Array methods own length conversion, deferred iterator reads,
completion, sparse indices and the `forEach` length snapshot. The usual native
length getter takes a fast path only while its prototype and descriptor remain
unchanged and the collection has no own length property. Page-defined getters
receive the original collection as their receiver.

The [independent comparison](evidence/collection-properties-chromium.json)
covers 38 contracts on 64 Chromium and 64 Nimbo pages, with no exceptions:
zero, truncated and extended lengths; accessor reads; inherited unsupported
indices; prototype changes during iteration; permanent iterator completion;
nonconfigurable length; callback identity; snapshot length; keys/entries and
throwing length getters, changed prototype getters and mutations during length
conversion. Native HTTP and real Worker regressions share the
synthetic fixture. The separate [1,000-element live iteration comparison](evidence/collection-properties-live-iteration-chromium.json) retains
its original default budgets.

The [three-round resource probe](evidence/collection-properties-resources.json)
uses fresh workerd pages, alternating builds and equal default limits at 100,
500 and 1,000 children. At 1,000 children both builds use 4,008 DOM operations
for values and forEach. Relative to a length-only extraction, the candidate's
additional used heap exceeds the baseline by a constant 126 bytes for values
and 112 bytes for forEach at every size. The baseline predates the receiver
correction; artifact hashes identify both builds. These are post-extraction
snapshots, not transient allocation or Worker memory peaks, and do not prove a
latency improvement or production capacity.

This closes the observed length and inherited-index iteration differences.
It does not establish the entire exotic collection property contract, select
iterator identity, all indexed definitions or complete Web IDL conformance.

```sh
bun run build:worker
NIMBO_COMPARE_CHROMIUM_BINARY=chromium-binary bun run tooling/compare-collection-properties.ts
bun test tooling/worker.test.ts -t 'collection iteration observes'
cargo test --locked -p nimbo-engine --test browser collection_iteration
```
