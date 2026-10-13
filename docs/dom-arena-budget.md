# Cumulative DOM arena budget

A page has a default budget of 65,536 allocated tree nodes over its lifetime.
The initial document, created elements/text/comments, independent documents,
DocumentFragments, ShadowRoots and HTML replacement fragments share this budget.
Removed nodes remain charged because the arena preserves their identity for
retained references. Attribute records remain separate from the tree-node count.

Native callers configure `Limits::max_dom_nodes`. Worker callers can lower the
quota with `maxDomNodes`, an integer from 1 through 65,536. The initial parser
uses the smaller of the initial and cumulative budgets. Exceeding the quota
returns `resource limit: DOM nodes`. A fresh page gets fresh counters.

HTML replacement feeds the native fragment parser directly into a detached part
of the page's arena. It uses the installed body-fragment context, decoder and
tree-building rules. After a successful parse, native reparenting replaces the
target's children. A failed parse preserves the previous children. Empty HTML
clears children without allocating new fragment nodes, including after quota
exhaustion. The native cancellation/deadline check runs between parser blocks.

The direct fragment parser retains three internal fragment/context nodes per
nonempty replacement; those nodes count toward the quota. It avoids the old
temporary document and arena copy. A rejected parser block may allocate its
bounded remainder before rejection; its allocations remain charged.

[Independent comparison](evidence/dom-fragments-chromium.json) covers detached
references, table recovery, UTF-8, namespaces, templates, empty content and
Shadow DOM. All eight checks passed in 64 Chromium and 64 Nimbo/celld pages.
This also verifies a correctness fix: the former merge path discarded text
foster-parented before a table; direct parsing preserves its browser order.

[Local memory evidence](evidence/fragment-arena-memory-local.json) repeats
10,000-element replacements at 1, 4, 8 and 16 iterations, then returns to one.
The original write-byte budget permits all these inputs. The old arena reaches
40,108,032 bytes of retained Wasm capacity. The candidate rejects replacements
above the node quota and reaches 30,212,096 bytes in this sequence; the final
small extraction succeeds. These measurements describe linear capacity, not
allocator peak or total Worker memory. Timing and production guarantees remain
separate work.
