# Live native control selectors

DOM queries and stylesheet matching share Nimbo's native selector parser and
Element adapter. Query selection reuses one matching cache over its iterator;
there is no duplicate tree adapter or parser fallback for nth-child `of` lists.

A borrowed control view reads the existing sparse checkedness arena and radio
index. It does not clone values, build JS wrappers or maintain a second state
map. Activation and selector evaluation share the same bounded radio-group and
form-owner calculation. Checked/indeterminate/disabled/enabled predicates charge
native operation counters, check cancellation/deadlines and publish explicit
errors when those checks fail. Diagnostics include pending selector work.
Native presence checks for checked/disabled/value/form/id attributes inspect
borrowed attributes without copying their values into temporary strings.

The supported state subset covers checkbox/radio checkedness, checkbox
indeterminacy, radio groups with no selected member, progress elements without
a value attribute, and enabled/disabled HTML form controls. Disabled-fieldset
traversal honors the first-legend exception. Optgroup and option rules are
separate from inherited fieldset disabling. Foreign namespace elements and
ordinary elements with a disabled attribute do not acquire control state.

An indeterminate checkbox does not match `:checked` in this implementation,
even when its `.checked` property is true, matching the independent Chromium
comparison. Option selectedness and form-associated custom-element state remain
open with the wider form-control implementation.

State-dependent selectors are dynamic, including nested `:has`, `:is`, `:not`
and nth-child `of` branches. State writes invalidate computed styles/layout;
compiled stylesheet rules and unrelated selector matches remain reusable.
Consequently a checkbox update changes its own CSS and ancestor `:has` rules
without changing the checked attribute or reparsing the stylesheet.

[Independent comparison](evidence/control-selectors-chromium.json) passed
44 contracts in 64 Chromium and 64 Nimbo/celld pages with default budgets.
Native/Worker regressions cover queries, closest, grouped radios, scoped Shadow
DOM, attached Attr mutation, live CSS, namespace exclusion and fresh-page state.
Native operation-budget and cancellation regressions reject false-match results,
and the 2,000-group storage regression remains green with shared native keys.

Full validation passed 8,154 Bun tests and 203 native tests in each
debug/release profile, plus strict formatting, TypeScript/Rust/Wasm lint and
Rust documentation checks. Focus/hover, validity, selection APIs and wider
form controls retain their existing boundaries.
