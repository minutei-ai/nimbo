# Owned reset-button activation

`HTMLButtonElement` has owned brands/descriptors and basic form, type, name,
value, disabled and formNoValidate properties. Type lookup is classified in Rust
using borrowed attributes and transfers only its canonical keyword. Form lookup
reuses the same bounded native owner calculation as inputs and textareas.

Click delivery captures potential native control handles from the existing event
path before listeners run. It retains no new control registry or copied DOM.
After event phase/currentTarget/path cleanup, uncanceled owned mouse/pointer
clicks resolve current reset type, disabled state and form owner. Plain Event
objects do not activate reset. Synthetic MouseEvent clicks with secondary buttons
follow the independent comparison; disabled controls remain inactive. Ordinary
`.click()` continues to use its existing reentrancy and disabled-fieldset guards.

Default activation calls the private form-reset algorithm, preserving trusted
reset event flags and reset cancellation/reentrancy. Overriding a form instance's
public reset method cannot replace that default behavior. Listener type/owner
changes and detached form trees are observed. Non-reset nested controls can fall
through to an enclosing reset control; href-bearing anchor paths form a barrier,
matching the declared synthetic comparison subset. Anchor navigation remains
outside this implementation.

[Independent comparison](evidence/reset-buttons-chromium.json) passed 42 contracts
in 64 Chromium and 64 Nimbo/celld pages at default budgets. Contracts cover button
and input reset activation, mouse/secondary/plain events, disabled and canceled
clicks, type changes, moved owners, method overrides, canceled reset events,
event cleanup, detached trees, descendant/nested paths, fieldsets/first legends
and button property/receiver/constructor descriptors. Native HTTP and Worker
regressions cover the same fixture. Existing checkbox/radio and direct form reset
regressions remain green in focused validation.

Full validation passed 8,159 Bun tests and 213 native tests in each debug/release
profile, plus formatting, strict TypeScript/Rust/Wasm lint and Rust documentation.

Submission, command/popover behavior, labels, validity, select-button inertness,
form collections and parser-specific historical ownership remain roadmap work.
Reset retains the [existing control-state boundaries](forms.md), including
explicit rejection of associated selects before changing supported controls.

The behavior follows the public [button interface and activation model](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element)
and [form reset](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#resetting-a-form).
