# Selected option named lookup

`HTMLCollection.namedItem` reuses a collection's existing native named lookup
when one is available. Both option collections already supplied that callback
for named property access; collection state now also makes it available to the
prototype method. Selected option searches create only the returned element's
handle and wrapper. No list, result cache, copied DOM or dependency is added.

The method checks its existing collection receiver state, converts its argument to a DOMString, and
then resolves the current collection. An empty converted name returns `null`
without enumeration. This also fixes live resolution after argument conversion
renames or inserts an element, including collections using the generic resolver.
Identity, selection filters and normal property hiding remain intact.

[Three-round local A/B evidence](evidence/selected-names-resources-local.json)
uses immutable baseline/candidate bundles and fresh workerd hosts, reversing
build order in the middle round. Six fresh pages per host cover missing, last
and empty names with 200 and 1,000 selected options. Artifact hashes and all
original budgets are recorded and compared for equality; no limit is overridden.

| 200 selected options | Baseline handles | Candidate handles | Baseline DOM operations | Candidate DOM operations |
| -------------------- | ---------------: | ----------------: | ----------------------: | -----------------------: |
| Missing name         |              202 |                 2 |                   2,009 |                      809 |
| Last option          |              202 |                 3 |                   2,010 |                      811 |
| Empty name           |              202 |                 2 |                   2,009 |                        6 |

For the missing-name case, QuickJS allocator-tracked bytes fall from 760,440 to
670,880. These are current page snapshots, not process RSS or allocator peaks.
At 1,000 options, all nine baseline attempts exhaust the original 10,000 DOM
operation budget; those failures remain explicit in the report. All eighteen
candidate extractions succeed, with 4,009 operations for a missing name,
4,011 for the last option and six for an empty name. The smaller baseline's
nine extractions also succeed. This report does not establish latency acceptance
or production capacity.

[Independent comparison data](evidence/collection-names-chromium.json) records
19 contracts over 64 Nimbo and 64 Chromium pages. Nimbo passes every normative
contract. Chromium 155 passes 18 and differs on mixed ID/name ordering: after
a later option receives a matching ID, Chromium returns it ahead of an earlier
option's matching `name`. The [DOM Standard's namedItem steps](https://dom.spec.whatwg.org/#dom-htmlcollection-nameditem)
require the first matching element in collection order. Nimbo retains that
algorithm. Chromium's false `order` result remains in the raw report with
status `reference-divergence` and an explicit reference profile; it is not
reported as exact browser parity.

Reference profiles apply only to the comparator. Missing declared checks,
changed reference behavior, any other failed check, and any Nimbo failure still
fail the comparison. Native and real HTTP/workerd regressions exercise the same
fixture and a 1,000-option lookup under original limits. Broader collection
enumeration and other named lookup paths remain separate profiling work.

```sh
bun run build:worker
bun run profile:collection-names baseline-bundle candidate-bundle
NIMBO_COMPARE_CHROMIUM_BINARY=chromium-binary bun run tooling/compare-collection-names.ts
```

The workerd benchmark host sets Miniflare's native `modulesRoot` to the bundle
directory, allowing immutable artifacts outside the checkout. A real-host
regression verifies that loading path; operational settings stay private.
