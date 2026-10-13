# Shadow DOM extraction

Nimbo owns imperative shadow roots in its Rust DOM arena. A root is a separate
document fragment linked to its host, with no light-tree parent. Document and
host queries, named window properties, `contains`, light-tree serialization and
`textContent` do not traverse into that fragment. Open and closed modes govern
the `shadowRoot` getter; a retained closed-root reference remains usable.

```js
const host = document.createElement("div");
document.body.appendChild(host);
const root = host.attachShadow({ mode: "open" });
root.innerHTML = '<p id="value">Loaded</p><slot></slot>';
root.querySelector("#value").textContent;
```

The supported extraction contracts include:

- `attachShadow`, `shadowRoot`, the `ShadowRoot` brand, read-only root metadata,
  fragment queries, `getElementById`, `innerHTML` and inherited child collections.
- `getRootNode({ composed })`, shadow-including connection, hierarchy-cycle
  checks and document adoption, with native ownership retained for nested roots.
- Automatic named slots, reflected `name`/`slot`, open-root `assignedSlot`,
  `assignedNodes`/`assignedElements`, bounded flattening and fallback nodes.
- Coalesced trusted `slotchange` events for assignment and fallback mutations,
  including event-handler properties on slots and roots.
- Composed event propagation, host target phases, nested retargeting and closed
  path filtering. The path and adjusted targets are captured before listeners;
  moving a node inside a listener does not rewrite those event records.
- Shadow-including custom-element upgrade, connection/disconnection and native
  ownership adoption. Definitions that disable shadow roots reject attachment.

The page admits at most 128 roots. Slot refresh, flattening and custom-element
walks consume the existing DOM operation budget. Roots, assignments, listeners,
pending microtasks and page globals are disposed with the page. The normal
Worker suite verifies failure cleanup and fresh state through real HTTP.

This is an extraction subset. Delegated focus, clonable/serializable roots,
manual assignment, scoped registries, declarative shadow parsing and the full
focus/related-target event model remain unsupported. Truthy unsupported
attachment options, manual assignment and scoped registry requests fail
explicitly. Shadow stylesheet APIs also fail explicitly. Connected shadow trees
invalidate ordinary layout; their geometry cannot be obtained by measuring the
host's light tree. Scoped shadow styles, flat-tree layout and geometry remain
the 0.5 roadmap work. Root count/DOM failures during page JavaScript return HTTP
422 with the underlying resource-limit reason in the JavaScript diagnostic.

The [synthetic fixture](../crates/engine/tests/fixtures/shadow-dom.txt) checks 57
contracts at 64 variants through native HTTP and Worker/Wasm. The
[Chromium/celld comparison](shadow-dom-chromium.json) retains every check:
128/128 pages passed in the recorded run. Additional Worker probes cover root
count, DOM limits, failure disposal and unsupported options/geometry. These are
supplemental contracts, not full Shadow DOM or slot-change WPT conformance.

References: [DOM shadow roots](https://dom.spec.whatwg.org/#interface-shadowroot),
[slots](https://dom.spec.whatwg.org/#shadow-tree-slots) and
[event dispatch](https://dom.spec.whatwg.org/#concept-event-dispatch).
