# Taffy grid container baseline

The Cargo workspace patches Taffy 0.14.0 to the minimal native fix at
[`e576ae520a8bd04039ebb4ba16386b6db2560ced`](https://github.com/minutei-ai/taffy/commit/e576ae520a8bd04039ebb4ba16386b6db2560ced).
This preserves the resolved 0.14 API and feature configuration.
The upstream change targets current main in
[Taffy PR #1321](https://github.com/DioxusLabs/taffy/pull/1321).

A grid item's final measurement already returns its first baseline. Taffy
previously discarded that value during positioning. When the track-sizing
baseline pass had not populated the item, the grid container synthesized its
baseline from the item's bottom edge. A baseline-aligned flex parent then
mispositioned siblings of grids with start, center or end-aligned measured text.
The fix carries the final measured baseline into the existing grid item,
including the native scroll-container clamp. Nimbo adds no baseline override.

The upstream regression uses a 30px-high measured child with a 21px baseline
in a 50px-high grid and a 10px reference sibling in a baseline-aligned flex
parent. Start/center/end alignment must position the reference at y=11/21/31;
unpatched Taffy produces y=20/30/40. On current upstream main the regression
fails without the fix, and all 147 handwritten tests pass with it (four existing
ignored tests). The 0.14 backport passes all 98 handwritten tests (four existing
ignored tests), using Rust 1.96. The backport's workspace test invocation was
blocked by a yanked `zip` dependency of its `getchrome` tool; the check instead
compiled its original handwritten test modules through an isolated path consumer.
No test bodies or layout dependencies were substituted.

Remove the Cargo patch and its git lockfile source when upgrading to an official
Taffy release containing the fix. Re-run the handwritten regression and Nimbo's
native and Worker/Wasm geometry tests against that release before removing it.
