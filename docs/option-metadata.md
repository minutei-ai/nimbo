# Native option metadata

`HTMLOptionElement` exposes text, value, label, index, form, disabled and
`defaultSelected` through owned brands, descriptors and the existing DOM bridge.
The element factory uses this interface only for HTML-namespace options.

Text normalization walks borrowed native nodes, excludes HTML/SVG script
subtrees and collapses ASCII whitespace across text-node boundaries. It creates
only the returned string, without an intermediate text copy, descendant array or
JavaScript wrappers. Unicode spaces retain their original meaning. Explicit
value and label attributes, including empty strings, bypass text traversal.
Namespace-qualified attributes cannot replace null-namespace values or flags.

The text setter performs the existing native replace-all operation, including
mutation notifications and custom-element reactions. Page overrides of
`textContent` cannot replace this algorithm. DOMString conversion occurs after
receiver validation, and symbols are rejected.

Index uses a borrowed tree cursor with select/datalist/hr/option and nested
optgroup boundaries. Form lookup follows the option's eligible ancestor select
and reuses bounded native form-owner calculation. Reordering, reparenting,
detached forms, explicit select owners and shadow boundaries are observed on
reads without a persistent option registry. Deep disabled optgroups now use the
same ancestor barriers in query and CSS control matching.

Native traversal charges the existing DOM-operation budget and checks
cancellation. Normalizing long individual text nodes checks cancellation every
8,192 characters. Regressions verify that text/index reads allocate no descendant
handles and that long whitespace-only text can be interrupted within one node.

The public [option interface and ownership rules](https://html.spec.whatwg.org/multipage/form-elements.html#the-option-element)
provide the reference. The synthetic comparison targets current Chromium text
behavior: manually inserted descendants of an HTML image contribute text, while
image alt attributes do not. The latest specification's image-subtree exclusion
is a separate compatibility difference, rather than an unverified conformance
claim.

[Independent comparison](evidence/option-metadata-chromium.json) passed 45
contracts in 64 Chromium and 64 Nimbo/celld HTTP pages at default budgets. Native
HTTP and Worker regressions run the same fixture, covering text mutations,
script/namespace handling, ownership and index changes, barriers, descriptors
and receiver/conversion rules.

Full validation passed 8,160 Bun tests and 217 native tests in each debug/release
profile, plus formatting, strict TypeScript/Rust/Wasm lint and Rust documentation.

Selection state, `selected`, `Option()` construction, select interfaces and live
option collections remain open. Associated selects continue to reject form reset
before changing supported input/textarea state. This implementation adds metadata
needed by selection; it does not close the broader form milestone.
