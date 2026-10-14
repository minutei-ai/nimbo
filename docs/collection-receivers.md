# Collection receiver contracts

Collection state now carries one private interface kind: node lists, element
collections or attribute maps. Native getters and `item` operations check that
kind; `HTMLCollection.namedItem` also requires an element collection. Option
collections inherit the element-collection contract. Both the owned target and
its public proxy share the existing state entry, with no extra brand WeakSets.

Changing a receiver's JavaScript prototype does not change its private kind.
A node list keeps working with the original NodeList getter and fails when
passed to the HTMLCollection getter. Forged prototype objects and unrelated
collections are rejected before argument conversion or DOM traversal.

Iteration has a different contract. NodeList `forEach`, `entries`, `keys` and
`values`, plus the HTMLCollection and NamedNodeMap iterators, accept generic
array-like receivers. The generic path delegates to Array methods provided by
the owned QuickJS runtime, captured before page scripts can replace them.
Nimbo keeps its existing version-aware ID resolver for owned collections rather
than repeatedly enumerating native identifiers during an ordinary iteration.
This adds no copied DOM, persistent iteration cache or runtime dependency.

[Independent evidence](evidence/collection-receivers-chromium.json) covers 86
contracts on 64 Nimbo and 64 Chromium pages. All checks pass on both runtimes,
without a declared reference divergence. The fixture covers native receiver
matrices, option inheritance, forged objects, changed receiver prototypes,
conversion ordering, callback receivers, generic validation ordering, sparse
and growing array-like iteration, null receivers and replaced Array methods.

An additional real HTTP/workerd and native regression calls generic `forEach`
with a sparse receiver of length one billion. The original JavaScript fuel
interrupts it; the Worker releases page capacity and the native browser accepts
a fresh navigation. No larger fuel, DOM, heap or timeout budget is requested.
The existing 1,000-option named-lookup regression still creates only two handles.

The comparison concerns these behaviors, not complete Web IDL conformance.
Own length/index shadowing, iterator function identity and the remaining exotic
property matrix still need separate compatibility work before the roadmap's
broader DOM gate can close.

```sh
bun run build:worker
NIMBO_COMPARE_CHROMIUM_BINARY=chromium-binary bun run tooling/compare-collection-receivers.ts
bun test tooling/worker.test.ts -t 'collection methods|generic collection'
cargo test --locked -p nimbo-engine --test browser collection_receivers
```
