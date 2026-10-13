# Live child collection memory

`childNodes` and `children` retain native node identifiers and reuse the existing
collection resolver. Reading their length no longer creates a JavaScript
wrapper for every child. Indexed access, `item`, iteration and named access
resolve wrappers when needed, preserving native identity and live mutations.
The change removes two eager mappings and adds no cache or dependency.

Before this change, `document.body.children.length` exhausted the default DOM
operation budget on 5,000 empty elements. Constructing wrappers triggered
thousands of unnecessary native calls. The same expression now succeeds at
5,000, 20,000 and 50,000 elements with the original limits. The
[local measurement](evidence/worker-dom-memory-local.json) keeps the baseline
failures explicit. It measures Wasm linear capacity, not live allocations or
production Worker memory. The 50,000-element count reaches 21,889,024 bytes;
repeating that count and returning to a smaller page do not grow capacity.
This comparison does not establish a latency improvement.

The shared 5,000-row HTTP fixture checks lengths, retained collection objects,
indexed node identity, removal, text insertion and reinsertion. Native and
workerd regressions use default budgets. All eight checks also pass in 64 fresh
Chromium pages and 64 Nimbo/celld pages. The
[independent aggregate](evidence/live-children-chromium.json) includes runtime
versions and the fixture hash.

```sh
bun run build:worker
bun test tooling/browser-live.test.ts --test-name-pattern 'large live child collections'
cargo test --locked -p nimbo-engine --test browser live_children_counts_and_mutations
NIMBO_COMPARE_CHROMIUM_BINARY=/path/to/chromium bun run tooling/compare-live-children.ts
```

Collections still enumerate native identifiers on each resolution. Long live
iterations, named lookup and initial DOM parsing need separate profiling;
this change does not introduce result caching or a new parser node budget.
