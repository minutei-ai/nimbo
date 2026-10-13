# Owned synthetic input activation

Nimbo owns `UIEvent`, `MouseEvent` and `PointerEvent` construction in the page's
QuickJS realm. Their inheritance shares one private event record. Initializer
fields are converted in sorted order, with receiver checks, numeric conversion,
modifier lookup, related-target brands and finite floating-point validation.
The initializer field tables are shared; absent coalesced/predicted sequences
allocate no retained arrays. Supplied sequences copy references, and returned
sequences are fresh arrays. Sequence conversion reads the iterator getter once
and rejects invalid members using the Web IDL sequence algorithm.

The constructor contracts cover 46 cases, including fractional pointer values,
legacy click coordinates, pressure precision, angle/tilt conversion, inherited
`which`, persistent IDs and malformed sequences. Frame views, legacy event
initializers, hardware pointer streams/capture and coordinates relative to a
dispatched target or document scrolling remain outside this supported subset.

`HTMLElement.click()` dispatches an untrusted primary `PointerEvent`, with a
reentrancy flag that is released after delivery. A disabled form control skips
that click. Native disabled-fieldset traversal applies the first-legend
exception and checks outer/nested fieldsets within the DOM operation budget.

For checkbox/radio inputs, the native engine performs pre-activation before
listeners. It toggles checkbox checkedness, clears indeterminate state, or
selects the radio in its native group. A small snapshot holds flags and at most
one previous-node handle. No DOM, value strings or group trees are copied.
Type classification borrows the native attribute and returns a typed enum.
Writes remain subject to the existing cumulative write budget.

After click delivery is cleaned up, a completed activation emits trusted
`input` and `change` events for connected controls. The input event bubbles
and is composed; change bubbles within its tree. Detached controls still update
and receive click, but do not emit these follow-up events. A plain Event named
click or a non-primary mouse button does not perform input activation. Explicit
primary MouseEvent/PointerEvent dispatch may activate a disabled input, while
its `.click()` method remains disabled.

Canceling restores checkbox checkedness and indeterminate state. A canceled
radio restores the former selection if it remains in the group. If that former
selection moved out during the listener, this implementation preserves the new
selection, matching the independently observed Chromium behavior. Listener
type changes are evaluated at completion; there is no forced rollback to the
old input type. These are bounded synthetic-control contracts, not a claim of
complete browser activation conformance.

The 36 activation contracts cover event order/flags/trust, state observed by
listeners, cancellation, reentrancy, detached state, radio selection, type
changes, disabled dispatch and first/nested legend behavior. Focused native
regressions also verify rejected activation writes preserve state before any
click listener runs, and a fresh page has no prior state.

[Event comparison](evidence/mouse-events-chromium.json) and
[activation comparison](evidence/input-activation-chromium.json) each passed
64 Chromium and 64 Nimbo/celld pages with default budgets. Full validation
passed 8,153 Bun tests and 200 native tests in each debug/release profile,
including strict TypeScript/Rust/Wasm lint, formatting and Rust documentation.

The full suite exposed a late timer delivery in the transition fixture: a
100 ms sample arrived after a 600 ms transition had completed. The fixture now
compares the completed value and retarget progress against elapsed time without
increasing tolerances. A real HTTP regression injects delayed samples, and
[25 transition contracts](evidence/transition-timing-chromium.json) passed in
128 independent comparison pages. Label forwarding, focus/pickers, form
submission/reset, anchor navigation and checked/indeterminate CSS selectors remain open.

The public contracts follow [HTML input activation](https://html.spec.whatwg.org/multipage/input.html),
[UI Events](https://w3c.github.io/uievents/),
[Pointer Events](https://www.w3.org/TR/pointerevents4/) and
[Web IDL sequences](https://webidl.spec.whatwg.org/#es-sequence).
