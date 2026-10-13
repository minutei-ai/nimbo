# Owned input and textarea controls

Nimbo owns `HTMLInputElement` and `HTMLTextAreaElement` interfaces in its
Rust/QuickJS engine. The initial value subset covers text, search, telephone,
password, URL and email inputs, including multiple-email sanitization, and
textarea values. Unknown input types use the standard text fallback.

The current value and default value are separate. Parsed controls remain clean
until `.value` is assigned; native dirty state is allocated only on that first
write. Subsequent attribute/default-text changes preserve dirty values. Changes
to input type or multiple-email state sanitize the existing value, including
writes through an attached `Attr`. Textarea defaults read direct child text;
its API value normalizes newlines and `textLength` counts UTF-16 code units.

Programmatic `.value` writes use the existing DOM operation and cumulative
write-byte budgets. A rejected write preserves the previous value. Dirty state
stays with the owned node when detached or moved within its page; it is disposed
with that page. A fresh extraction gets fresh defaults and state.

Both interfaces expose name, placeholder, disabled, required and readOnly
reflection. Inputs also expose multiple and the standard type-name reflection.
Constructors, brands, property descriptors and receiver checks are owned. Value
assignment in text modes does not create an attribute mutation record; changing
an input's default value does. Programmatic value assignment does not synthesize input or
change events.

[Independent Chromium comparison](evidence/text-controls-chromium.json) passed
38 contracts in 64 Chromium and 64 Nimbo/celld pages over real HTTP. Native and
Worker regressions use the same fixture and separately verify budget rejection
and fresh-page isolation. All comparisons retain the original default limits.

Hidden, submit, image, reset and button inputs implement the default value mode:
`.value` reflects the value attribute without text sanitization. Checkbox and
radio inputs implement default-on values, returning `on` when the attribute is
absent. These modes reuse the owned attribute storage rather than allocating
separate current-value state. Reflected writes produce attribute mutation
records and use the same cumulative write budget.

Changing from a dirty text value to a default/default-on mode transfers a
nonempty current value to the attribute. A clean control retains its original
attribute, including whitespace. Returning to a text mode resets dirty state.
Type changes through ordinary attributes, namespaced attributes and attached
Attr nodes follow the same transition path. Classic HTML attribute names are
case insensitive. Transfer writes remain subject to the existing budget;
unsupported numeric and file value behavior remains explicit.

[Independent value-mode comparison](evidence/input-value-modes-chromium.json)
passed 44 contracts in 64 Chromium and 64 Nimbo/celld pages. Native and Worker
regressions cover rejected reflected writes and fresh-page state.

Inputs expose owned `checked`, `defaultChecked` and `indeterminate` state.
Current checkedness becomes dirty on assignment and remains separate from the
checked attribute. Programmatic state writes do not synthesize events or
attribute records. State is sparse, native, page-local and subject to the
existing operation and write budgets.

Radio selection uses the exact nonempty name, tree root and form owner.
Groups are isolated across documents, fragments and shadow roots. Checked
radios are indexed by group; the two native indexes share one group key.
The common insertion path visits the moved subtree. Explicit form references
trigger bounded owner lookup when IDs or their trees change. Detached controls
use ancestor form association. HTML parsing initializes selection in tree
order before scripts, and HTML/text replacement preserves detached controls.

[Independent checkedness comparison](evidence/input-checkedness-chromium.json)
passed 50 contracts in 64 Chromium and 64 Nimbo/celld pages. The fixture covers
attached Attr writes, receiver/descriptor behavior, type/name changes, initial
selection, form ID changes, missing/foreign form targets and replacement.
Validation passed 8,151 Bun tests and 197 native tests in each debug/release
profile, plus strict formatting, TypeScript/Rust/Wasm lint and Rust documentation
checks. A native storage test checks 2,000 clean groups, repeated reads and
group merges without eager native handles or duplicate retained group names.

[Owned synthetic activation](input-activation.md) adds mouse/pointer event
interfaces, click pre-activation and cancellation, native disabled-fieldset
checks and ordered input/change events, with 46 event and 36 activation
contracts verified independently. Reset, constraint validation,
checked/indeterminate CSS pseudo-classes and parser-specific malformed form
associations remain open.

This is the implemented control subset of roadmap 0.3. Number/date/range/color/file values,
select/options, wider form ownership/reset/submission,
selection, validity and control-specific geometry remain open.

The contracts follow the public [input model](https://html.spec.whatwg.org/multipage/input.html)
and [textarea model](https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element).
