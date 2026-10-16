# Native Taffy layout and grid baseline

The engine depends directly on official Taffy commit
[`e77a7a8d9c1acfde11a819cc5085fa8eca9a322f`](https://github.com/DioxusLabs/taffy/commit/e77a7a8d9c1acfde11a819cc5085fa8eca9a322f),
on the 0.15 development line. There is no workspace Cargo patch or fork dependency.
Replace the git pin with an official registry release when it contains this commit,
then rerun native, Worker/Wasm and independent geometry checks.

[Taffy PR #1322](https://github.com/DioxusLabs/taffy/pull/1322) supersedes
[#1321](https://github.com/DioxusLabs/taffy/pull/1321), preserves the original
commit authorship and adds the maintainer's correction for a first item's top
margin being counted twice. Its 16 Chrome-generated fixtures cover final item
baselines and track-sizing baselines. Nimbo has no grid baseline override.

The 0.15 integration uses native static, relative, absolute, fixed and sticky
positions, concrete container alignments and the native out-of-flow pass.
Nimbo supplies CSS containing-block policy: positioned boxes claim absolute
children; transformed boxes also claim fixed children. Grid and core container
styles share this policy. Native grid placement information is retained for
absolute grid items.

The structural tree remains intact. Native hoisted-child receipts own the
coordinate-parent relationship used by geometry, percentage padding and
intersection traversal. Unclaimed absolute/fixed boxes use the initial
containing block and viewport dimensions. Inline layout propagates candidates
from atomic descendants with their final line positions. The former static
position measurement and manual reparenting pass is removed.

Validation must preserve existing expected geometry. The native browser suite
covers positioning, generated boxes, transformed containing blocks, scrolling,
sticky geometry, CSSOM inset values and real-font flex/grid baselines. The
Worker suite exercises the same engine compiled to Wasm. The repository's
`compare:text-baseline` and positioning comparators check synthetic fixtures
against ordinary Chromium and the Worker runtime; they are supplemental
contracts, not WPT conformance results.
