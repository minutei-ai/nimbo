# Owned form association and reset

Nimbo provides an owned `HTMLFormElement` interface, `reset()` and readonly
input/textarea `.form` getters. Getters and radio groups share the native
form-owner calculation. It reads the current tree, supports nearest ancestors,
connected explicit form IDs, first-ID precedence, dynamic moves and attribute
changes, detached trees and scoped Shadow DOM. No second ownership index or
JS-side control registry is retained.

The reset method fires a trusted, bubbling, cancelable, non-composed event before
reading its controls. Cancellation leaves values unchanged. A per-form weak guard
prevents recursive reset. Listener additions, removals, changed defaults and
changed owners are observed before native reset begins. Reset changes internal
state without generating input/change events or attribute mutation records.

Native reset first builds a bounded plan of control IDs and default radio-group
keys. Traversal charges the existing DOM-operation budget and checks the native
cancellation/deadline signal. The complete plan and write budget are validated
before changing control state. Reset removes native dirty values and restores
checkedness/default flags while retaining indeterminate state. Radio selection
reuses the existing shared-key index in tree order, including browser-observed
dirtiness of radios deselected by group normalization. State changes invalidate
computed styles/layout while retaining compiled stylesheet rules.

The plan is temporary; it does not copy the DOM, values or manufacture control
wrappers. Stored dirty values are removed from the existing sparse maps.
Explicit-owner searches compare borrowed ID attributes. Other native selector
comparisons share that borrowed attribute helper.

[Independent association](evidence/form-ownership-chromium.json) and
[reset comparisons](evidence/form-reset-chromium.json) passed 23 association
and 26 reset contracts in 256 fresh comparison pages with default limits. Association
includes ordinary/explicit owners, duplicate IDs, nesting, namespace exclusion,
Shadow DOM, disconnected trees, interface brands and descriptors. Reset includes
text/textarea defaults, checkbox/radio state, indeterminate values, dirty flags,
event flags, cancellation, reentrancy, listener mutations, external controls,
nested forms, detached state and CSS invalidation. Native regressions reject an
over-budget reset before state changes.
Repeated-reset storage checks remove dirty values and checkedness records without
retaining clean per-control state. Full validation passed 8,158 Bun tests and
212 native tests in each debug/release profile, plus formatting, strict
TypeScript/Rust/Wasm lint and Rust documentation.

This is the existing text/checkedness control subset. A form containing an
associated select currently fails reset explicitly before changing any controls.
Select/options, other value states, form collections and named properties,
submission, reset-button activation, form-associated custom elements and
parser-specific historical ownership remain roadmap work.

The behavior follows the public [form association](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#association-of-controls-and-forms)
and [reset algorithms](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#resetting-a-form).
