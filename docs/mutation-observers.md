# Mutation observation

Nimbo captures DOM changes in its Rust arena and delivers owned `MutationRecord`
objects through QuickJS microtasks. Observation supports `childList`,
`attributes`, `characterData`, `subtree`, old values and attribute filters.
Repeated attribute writes produce records, while removal of a missing attribute
does not. Namespace filters, overlapping registrations and option updates use
native node identity.

`takeRecords()` drains records without delivering the callback. `disconnect()`
removes registrations and discards queued records. Detached subtrees retain
transient observation until the next notification; shadow roots require their
own registrations. Record node lists are static, retain native node identity,
and use the existing `NodeList` interface.

Callbacks run asynchronously in observer creation order. A callback can enqueue
records for a later observer in the same notification or schedule a subsequent
notification for itself. Exceptions are reported through the page error event
without stopping other callbacks. Mutation callbacks and `slotchange` delivery
share the DOM notification microtask, with observers delivered first.

Limits apply per page:

| Resource                                         | Limit |
| ------------------------------------------------ | ----- |
| Observer instances                               | 128   |
| Registrations, including transient registrations | 1,024 |
| Queued records across all observers              | 4,096 |
| Logical retained record bytes                    | 4 MiB |
| Attribute filter entries                         | 128   |
| UTF-8 bytes per filter entry                     | 512   |

Observation scans charge the shared DOM operation budget. Ancestors are scanned
once per mutation and registration matching uses the resulting set. QuickJS
heap, fuel, microtask and page deadline limits still apply. Observer capacity is
retained for the page lifetime; disconnecting an observer permits reuse of its
registrations and queue, rather than allocating unlimited new observers.

The implementation observes the engine's existing mutation APIs. It does not
add missing DOM editing APIs, declarative shadow parsing or framework hydration
coverage. Wider application compatibility remains part of roadmap 0.3.

Public reference: [DOM mutation observers](https://dom.spec.whatwg.org/#interface-mutationobserver).
The [synthetic comparison](mutation-observer-chromium.json) checks 40 contracts
across 64 fresh HTTP pages each in Chromium and Nimbo/celld. The same fixture
runs in the native engine and Worker/Wasm. Additional Worker cases exercise
observer, record and filter limits, shared work budgets and recovery after
failure.
