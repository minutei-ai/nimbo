# Worker process RSS high water

The memory profile also records the Linux kernel's `VmHWM` for the single owned
workerd process. This is a process-lifetime resident-set high water mark, including
runtime startup, code, Wasm and host allocations. It can preserve a transient
resident-memory increase that occurs between post-response RSS samples.

The [kernel's proc documentation](https://docs.kernel.org/filesystems/proc.html)
defines `VmHWM` as resident-set high water and notes that RSS accounting is
asynchronous and approximate. Small counter differences must not be interpreted
as exact allocator behavior or regression acceptance. No proc counter is reset
and no forced garbage collection is performed on the measured Worker.

`bun run profile:worker-memory` emits schema version 2. Each sample includes:

| Field                                | Scope                                               |
| ------------------------------------ | --------------------------------------------------- |
| `host_rss_after_request_kib`         | Current RSS summed over the owned host process tree |
| `workerd_process.rss_kib`            | Current RSS of its one workerd process              |
| `workerd_process.rss_high_water_kib` | That process's lifetime RSS high water              |
| `diagnostics.wasmLinearBytes`        | Retained linear capacity of its one Worker isolate  |
| `diagnostics.javascriptUsedBytes`    | Current owned page's QuickJS used-byte accounting   |

The process tree is read from `/proc` under the owned benchmark host. Attribution
requires exactly one process named `workerd`. Missing or incomplete trees and
ambiguous owners return `null`; unavailable measurements are never zero. PIDs,
command lines, environments and process status records are not published.
Independent process high water marks are not summed: their peaks can occur at
different times. The ordinary corpus's retained-RSS field keeps its existing
meaning and report schema.

Each of three profile rounds starts a fresh host, so its lifetime includes only
startup and the declared four-request sequence. Measurements require Linux;
they are nullable on other platforms. This measures local process RSS, not
per-page live bytes, Wasm allocator peak, QuickJS allocator peak or the Cloudflare
isolate's billed memory. Diagnostic heap walks add overhead, so this profile
does not establish latency acceptance or production capacity.

[Local raw evidence](evidence/worker-rss-high-water-local.json) records all twelve
successful extractions with available process measurements and original limits.
The three rounds end with workerd high water marks of 181,720, 184,504 and
186,544 KiB, equal to their ending RSS samples in this workload. Each recovered
small page reports 630,832 QuickJS used bytes. The retained process footprint
and fresh page heap therefore remain distinct measurements. This is a single
artifact profile, not an A/B optimization result or a controlled-runner gate.

The regression uses an owned Bun subprocess that touches a synthetic 64 MiB
buffer and then releases it with explicit GC. Its RSS recovers while the kernel
counter retains most of the observed peak. Separate tests use real workerd
hosts to verify attribution, ambiguity rejection and unavailable readings after
disposal. The forced GC belongs only to that subprocess regression fixture.
