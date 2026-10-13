# Native selector traversal limits

Queries, `matches`, `closest` and stylesheet matching use a borrowed native
checkpoint view. Checkpoints run while entering a match and walking descendants,
ancestors, siblings or children, including non-element nodes skipped by the
matcher. An error stops the iterator or navigation callback, and the outer DOM
call publishes that error instead of a partial list or false match.

Native checkpoints invoke the existing cancellation/deadline checker. Worker
hosts cannot observe an external abort during a synchronous Wasm call, so both
hosts also enforce a fixed ceiling of 1,000,000 selector checkpoints per page.
The counter is cumulative across queries and stylesheet matching; a subsequent
call cannot reset exhausted fuel. It uses one native integer, with no copied
DOM, wrapper cache or per-node state. Cached CSS matches do not execute the
matcher and do not need traversal fuel.

Exhaustion produces `resource limit: selector steps`. A discarded page releases
its ordinary page resources; a fresh page starts with fresh fuel. The ceiling
is separate from the existing configurable DOM-operation budget, whose counting
and defaults remain unchanged. Checkpoint count measures matcher entry and
native navigation work, not JavaScript instructions, elapsed time or total
engine work. Parser complexity and other native operations retain their own
limits and hardening boundaries.

Native regressions cancel ordinary queries after entry and during ancestor,
comment-separated sibling, child and `:empty` traversal. A relational selector
on 2,000 elements exceeds the checkpoint ceiling without registering query
result handles or charging additional DOM bridge operations. The Worker HTTP
regression checks explicit rejection and fresh-page recovery on the same host.

Full validation passed 8,156 Bun tests and 207 native tests in each debug/release
profile, plus formatting, strict TypeScript/Rust/Wasm lint and Rust documentation.

This extends [cancellation](cancellation.md); asynchronous host waits and
incremental initial parsing keep their existing interruption paths.

[Local corpus comparison summary](evidence/selector-traversal-corpus-local.json)
records 2,808 correct extractions across two three-round Worker A/B runs of all
13 corpus workloads at default DOM limits. Reversing labels compares the same
artifacts in the opposite direction. All memory samples were collected and no
RSS comparison crossed its threshold. Four original and twelve reversed
scenario/round comparisons raised latency flags; both runs exited 1. This does
not establish stable attribution or pass the controlled performance gate. Full
local samples remain in the runner reports identified by their hashes.
