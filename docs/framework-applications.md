# Framework extraction applications

Nimbo's own Rust/QuickJS engine runs synthetic prerendered applications with
unmodified Preact 10.29.8 and Vue 3.5.22 browser modules. The modules are pinned,
licensed test fixtures, served over real HTTP. They are absent from the engine
and Worker runtime dependencies. [Fixture sources and hashes](../crates/engine/tests/fixtures/frameworks/README.md)
identify the exact distributions.

Each framework uses its public hydration API and retains the original server
root, button and keyed list nodes. Events trigger framework state updates. The
application then reorders, inserts and removes keyed items, fetches JSON,
observes native mutations and unmounts through the framework's lifecycle APIs.
Adapters only connect the application to the framework's own APIs.

| Application | State model                                 | Checked contracts per page |
| ----------- | ------------------------------------------- | -------------------------- |
| Preact      | `Component` and `setState`                  | 14                         |
| Vue         | `createSSRApp`, `shallowRef` and `nextTick` | 14                         |

Both applications run at the unchanged default engine limits. The
[Chromium/Nimbo comparison](framework-applications-chromium.json) retains results
for 64 fresh HTTP pages per framework in each runtime. The same fixtures run in
native tests and Worker/Wasm tests.

The observed gaps required two engine changes: `Node.hasChildNodes()` reads the
owned tree, and common event handler properties expose the existing event
system. Handler properties retain listener position when replaced, move to the
end after removal/reactivation, preserve callable identity, ignore non-callable
objects during dispatch and cancel cancelable events only for a `false` result.
They validate receivers and expose enumerable accessors with Web IDL names and
arity. Registration uses captured listener methods, preserving the engine's
behavior when page code overrides public methods. Existing `onslotchange`
properties share that implementation.

Supported handler properties cover click, double-click, context menu, mouse and
pointer events, input/beforeinput, change, submit/reset, focus/blur, keyboard
input, load and scroll/scrollend on HTML elements, SVG elements, documents and
the page window. These properties do not implement device input, default form
activation or inline event-handler content attributes. The
[primitive comparison](dom-primitives-chromium.json) checks 24 contracts across
64 fresh pages in each runtime, including native child presence, brands,
receiver checks, cancellation and descriptor behavior.

This evidence covers the declared applications. History-driven client
navigation, wider form controls, inline handlers and arbitrary framework
applications remain open in roadmap 0.3.

Public references: [Preact hydration](https://preactjs.com/guide/v10/api-reference/#hydrate),
[Vue application hydration](https://vuejs.org/api/application.html#createssrapp),
[DOM child presence](https://dom.spec.whatwg.org/#dom-node-haschildnodes) and
[HTML event handlers](https://html.spec.whatwg.org/multipage/webappapis.html#event-handler-attributes).
