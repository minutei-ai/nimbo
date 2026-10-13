# Live collection iteration

Live collection iteration reuses its resolved identifiers while the native
mutation version stays unchanged. A mutation triggers another resolution before
reading the next index. Static query results retain their snapshot semantics.
The cache belongs to the current iterator or `forEach` call; ordinary collection
reads do not retain a new result cache.

The shared HTTP fixture checks 1,000-element iteration and keys, `forEach`,
prepend/removal during iteration, callbacks, static snapshots, tag queries,
attributes, Shadow DOM and XML documents. All 11 checks pass in 64 fresh Chromium
pages and 64 fresh Nimbo/celld pages, recorded in the
[independent aggregate](evidence/collection-iteration-chromium.json).

The [default-budget resource probe](evidence/collection-iteration-resources.json)
validates 100, 500 and 1,000 children on both builds. The candidate's used-byte
snapshot increases by 835 bytes and its object count by one at every size; it
does not retain an identifier array proportional to the completed iteration.
DOM operation accounting includes one extra native read at the first resolution.
JavaScript heap snapshots are not allocation peaks or total Worker memory.

The [local alternating A/B run](evidence/collection-iteration-ab-local.json)
uses three warmups and 15 measured requests per build. Every extraction returns
the expected value. Its benchmark budgets are explicit: 100,000 DOM operations
and 4,096 layout nodes; the separate resource probe uses defaults. Process-tree
RSS includes the development host and is sampled after requests. Local timings
do not establish production capacity or replace the controlled regression gate.

```sh
bun run build:worker
bun test tooling/browser-live.test.ts --test-name-pattern 'collection iteration follows'
cargo test --locked -p nimbo-engine --test browser live_collection_iterations
NIMBO_COMPARE_CHROMIUM_BINARY=/path/to/chromium bun run tooling/compare-collection-iteration.ts
CELLD_MAX_STATELESS_ISOLATES=1 NIMBO_BENCH_BASELINE_BUNDLE=/path/to/baseline bun run tooling/benchmark-hot-paths.ts live-child-iteration
```
