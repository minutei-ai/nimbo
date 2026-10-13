# Owned text controls

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
assignment does not create an attribute mutation record; changing an input's
default value does. Programmatic value assignment does not synthesize input or
change events.

[Independent Chromium comparison](evidence/text-controls-chromium.json) passed
38 contracts in 64 Chromium and 64 Nimbo/celld pages over real HTTP. Native and
Worker regressions use the same fixture and separately verify budget rejection
and fresh-page isolation. All comparisons retain the original default limits.

This is the text-control part of roadmap 0.3. Other input value modes currently
throw `unsupported: input value state`; type-name reflection alone does not
claim those modes are implemented. Number/date/range/color/file values,
checkbox/radio checkedness, select/options, form ownership/reset/submission,
selection, validity and control-specific geometry remain open.

The contracts follow the public [input model](https://html.spec.whatwg.org/multipage/input.html)
and [textarea model](https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element).
