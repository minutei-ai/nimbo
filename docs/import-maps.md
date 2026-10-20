# Parser-time import maps

Nimbo resolves supported import maps inside its Rust module resolver. QuickJS
still compiles, links and evaluates the graph, including cyclic live exports.
There is no source rewriting or browser runtime dependency.

The supported subset is one inline `<script type="importmap">`, placed before
module scripts. Classic scripts may precede the map. The map is registered in
script order, so a dynamic import executed before registration cannot use its
aliases. Its JSON `imports` and `scopes` objects support exact
aliases, URL normalization, JSON declaration order for normalized collisions,
directory prefixes, overlapping scopes and fallback
to less-specific scopes or global imports. Null or invalid mapping values block
resolution. Directory mappings cannot escape their target prefix. Every resolved
module still passes the existing HTTP(S), credentials and origin policy.

Maps are limited to 64 KiB, 1,024 specifier entries and 128 scopes. Module
specifier inputs are limited to 4,096 bytes. The normal response, request,
deadline and JavaScript memory limits still apply. Exact lookups use a native
ordered map; prefix searches are bounded by the entry cap.

Multiple maps, maps after module declarations and external parser-time maps fail explicitly. Integrity metadata
is unsupported and fails explicitly. Dynamic map insertion/merging and fetching
previously unloaded modules through `import()` remain outside this subset.
Dynamic imports of already loaded mapped modules use the same resolver and
QuickJS module cache.

The native HTTP regression covers scoped aliases, cyclic live bindings, cached
dynamic imports, classic script ordering, early-import rejection, blocked entries, prefix traversal, destination rejection and
fresh-page isolation. The Worker fixture and independent Chromium comparison
passed 64 fresh pages each ([comparison report](import-maps-chromium.json)). Run `bun run compare:import-maps` with
`NIMBO_COMPARE_CHROMIUM_BINARY` pointing to ordinary Chromium.

Reference: [HTML module specifier resolution and import maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps).
