# Taffy grid container baseline

The Cargo workspace patches Taffy 0.14.0 to the minimal native fix at
[`e576ae520a8bd04039ebb4ba16386b6db2560ced`](https://github.com/minutei-ai/taffy/commit/e576ae520a8bd04039ebb4ba16386b6db2560ced).
This preserves the resolved 0.14 API and feature configuration.
The upstream change is maintained in
[Taffy PR #1322](https://github.com/DioxusLabs/taffy/pull/1322), which supersedes
[#1321](https://github.com/DioxusLabs/taffy/pull/1321) and preserves its original
commit authorship. The maintainer also corrects the border-box baseline used
during track sizing and replaces the mock-measure regression with 16 generated
fixtures checked against Chrome, including an item with a top margin.
That additional track-sizing change is not included in this 0.14 backport.
At the time of this update, #1322 is open against the 0.15 development line;
0.14.0 remains the latest official release. Its head cannot replace the current
pin without migrating and validating Nimbo against the 0.15 API.

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
