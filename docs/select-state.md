# Native select state

`HTMLSelectElement`, `HTMLOptionsCollection`, `HTMLOptionElement.selected`, the
`Option` factory and basic `HTMLOptGroupElement` properties use owned DOM
interfaces. Selectedness and dirty flags live in Rust, separate from default
selection attributes. The arena stores only dirty or non-default states; clean
multiple-select defaults need no per-option records. Initialization is lazy per
select. Query and CSS `:checked` use the same native state.

Native selection observes explicit empty selections, default attribute changes,
no-op selected assignments, implicit first-enabled selection, multiple/size
changes, incoming selected options, detached selections and reordered/moved
options. Hooks cover ordinary, namespaced and Attr-node mutations. Select and
option lists share the existing borrowed tree cursor and eligibility barriers.
Node creation and parsing retain conservative control-tag presence guards.

Collections remain live and retain object identity. Counts, indexed reads,
selectedIndex and value avoid materializing all option wrappers. Select and
options-collection named lookup also use native traversal. Iteration and key
enumeration remain live. Indexed
assignment, add/remove and collection length use owned DOM mutation paths;
page overrides of the public options property cannot redirect internal reads.
Select proxies retain DOM identity, event receivers and normal expando behavior.

Length changes execute as a native batch, preflight cumulative node capacity and
write limits, and normalize selection once. Growing 1,000 options fits the native
default operation budget without allocating option handles; only one implicit
selection record remains for a clean single select. Length changes retain native
mutation records, document ownership and custom-element disconnection reactions.
Like ordinary DOM mutation, observer-budget failures can leave partial tree
changes; lazy selection initialization is invalidated on such failures.

Form reset gathers associated selects and their options before changing any
supported control state. It preflights traversal and total write limits, then
restores default selection and clears option dirty records. Reset listeners,
cancellation, explicit form owners and reset-button activation reuse the existing
owned form algorithm. Rejected selection writes and reset preserve existing
selection. Reset storage tests reduce 64 dirty option records to one implicit
selection record.

Owned strings for input/textarea and option responses are transferred into
`serde_json::Value::String` rather than cloned through the json macro. Explicit
option values are compared through borrowed attributes. Size parsing returns a
native scalar, bounds integers and checks work while scanning long numeric
prefixes. These changes remove intermediate copies; they are not a measured RSS
or latency improvement claim.

The public [select/option rules](https://html.spec.whatwg.org/multipage/form-elements.html#the-select-element)
and [options collection algorithms](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#htmloptionscollection)
provide references. The comparison targets current Chromium behavior. Its
option selected setter leaves dirty flags unchanged for no-op assignments;
ignored dirty default changes do not normalize selection. Its add operation
rejects element references nested within optgroups, although the current
specification permits descendant references. Growth records are emitted per
option, matching the comparator. These are declared compatibility differences.

[Independent comparison](evidence/select-state-chromium.json) passed 72 contracts
in 64 Chromium and 64 Nimbo/celld pages at default budgets. Native HTTP and
Worker regressions cover the same fixture, including query/CSS state changes,
no-op/dirty defaults, ownership/reset cancellation, indexed collections, large
size prefixes, mutation records and custom-element disconnection. Separate
native regressions cover sparse storage, lazy handles, bounded batch resizing
and rejected writes/reset.

Full validation passed 8,161 Bun tests and 222 native tests in each debug/release
profile, plus formatting, strict TypeScript/Rust/Wasm lint and Rust documentation.

Labels, validity, pickers, submission, selectedcontent cloning, complete exotic
property descriptors and parser-specific historical form ownership remain open.
In particular, indexed non-configurable descriptors are rejected before changing
options; ordinary configurable indexed setters are supported. The JavaScript
proxy cannot reproduce every native platform-object descriptor rule. This does
not close the broader form or complete-browser milestone.
