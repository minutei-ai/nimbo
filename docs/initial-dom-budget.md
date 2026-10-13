# Initial DOM node budget

Initial HTML parsing has a default budget of 65,536 allocated tree nodes.
The document, implied elements, text, comments, doctype, processing instructions
and template fragments count toward that budget. Adjacent text chunks that the
native parser merges into one node count once. Attribute records are separate
from this tree-node count and remain bounded by input bytes.

Nimbo feeds 8 KiB byte blocks through the installed html5ever parser and
dom_query document sink. The UTF-8 decoder and tree-building rules remain native.
The adapter counts allocation callbacks and checks the budget before accepting
another block, then checks nodes implied by EOF. A rejected block can allocate
its bounded remainder before returning the resource error. Native cancellation
and deadlines are checked between blocks. Stored parser error diagnostics are
limited to 128 entries; parser recovery continues normally.

Native callers configure `Limits::max_initial_dom_nodes`. Worker callers can
lower the budget with `maxInitialDomNodes`, an integer from 1 through 65,536.
Invalid Worker flags fail before origin HTTP. An oversized tree returns
`resource limit: initial DOM nodes` before script collection or QuickJS setup.
The Worker returns 422, then releases the scoped transport and page resources.

[Local evidence](evidence/dense-dom-memory-local.json) uses one isolate and
synthetic repeated `<p>` start tags. Previously, 300,000 elements from about
900 KB of HTML reached 125,435,904 bytes of Wasm linear capacity. With the budget,
overlarge inputs reject and capacity reaches 33,882,112 bytes in that sequence.
The accepted 50,000-element extraction succeeds again after all rejections.
These are capacity measurements, not allocator peak or total Worker memory;
they do not establish a platform-wide memory guarantee.

Native and workerd HTTP regressions verify rejection and fresh-page recovery.
Parser tests cover node boundaries, text merging across UTF-8 chunk boundaries,
templates, table recovery, cancellation and bounded error storage.

The initial cap is complemented by a [cumulative arena budget](dom-arena-budget.md)
for tree nodes created by scripts and fragment writes. Attribute records retain
their input/write-byte budgets. Additional deep-tree traversal and attribute
allocation hardening remain roadmap work.
