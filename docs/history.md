# Same-document history

Nimbo owns history entries and URL rewriting in Rust. QuickJS exposes `History`,
`pushState`, `replaceState`, `back`, `forward`, `go`, `length`, `state` and
`scrollRestoration`. Rewriting accepts HTTP(S) URLs with the same scheme,
credentials, host and port as the active document. It updates the document URL
without replacing the DOM or reloading the document.

State serialization preserves cycles, shared references, sparse arrays, UTF-16
strings, undefined, non-finite numbers, negative zero, BigInt, Map, Set, Date and
RegExp. RegExp lastIndex is reset. A page cannot serialize functions, symbols,
proxies, DOM nodes or other unsupported platform objects. Binary buffers,
Errors and custom prototypes remain unsupported and fail explicitly with
DataCloneError. Repeated state reads retain the current decoded object; a
traversal restores the serialized snapshot, independent of changes to the
original object or an earlier decoded state.

Traversal runs asynchronously through the existing bounded task scheduler.
The engine emits trusted popstate events. When URLs differ only in fragment,
a later task emits hashchange after the popstate microtask checkpoint. A path
change with a different fragment emits popstate without hashchange. pushState
and replaceState emit neither event. Event constructors, brands, receiver
checks and enumerable descriptors are covered by the same owned event system.

Relative fetch and newly initiated resources resolve against the current
document URL. Existing base elements retain their frozen resolved URLs until a
real base mutation; already loaded stylesheet URLs retain their identity.
Document.cookie continues to use the document creation URL, while HTTP cookie
selection follows each actual request URL. These distinct scopes match the
independent browser fixture.

| Resource                           | Per-page limit    |
| ---------------------------------- | ----------------- |
| History entries                    | 128               |
| Encoded state per entry            | 64 KiB            |
| Input URL                          | 4,096 UTF-8 bytes |
| Retained state and serialized URLs | 1 MiB             |
| Objects per state graph            | 256               |

DOM work, heap, fuel, timers, microtasks and the original page deadline remain
shared with extraction. Capacity checks precede entry changes. A new branch
after traversal discards forward entries and releases their retained state.

Reload through go(0), cross-document navigation, Location setters, the Navigation
API and automatic scroll position restoration remain unsupported. The
scrollRestoration mode is retained; it does not simulate missing restoration.

The [independent comparison](history-chromium.json) checks 35 contracts across
64 fresh HTTP pages each in Chromium and Nimbo/celld. The same fixture runs in
native and Worker/Wasm tests. Additional Worker tests cover quota failure,
unsupported reload, graph bounds and clean page state after failure. The
[framework applications](framework-applications.md) exercise routing and
back/forward state updates through Preact and Vue.

References: [HTML history API](https://html.spec.whatwg.org/multipage/nav-history-apis.html),
[document base URLs](https://html.spec.whatwg.org/multipage/urls-and-fetching.html)
and [history traversal](https://html.spec.whatwg.org/multipage/browsing-the-web.html).
