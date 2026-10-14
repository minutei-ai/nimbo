# Bounded local load tests

The load runner reuses the versioned extraction corpus and the native/Worker
adapters from the A/B benchmark. Every extraction creates a fresh page. Native
runs also create a fresh process; Worker runs reuse their host. These placements
must be compared and reported separately.

```sh
bun run tooling/benchmark-load.ts native target/release/nimbo-engine 4 30
CELLD_MAX_STATELESS_ISOLATES=1 bun run tooling/benchmark-load.ts worker dist/worker 8 30
```

Build and validate the exact artifacts first. Arguments are runtime, artifact,
concurrency and duration in seconds. Concurrency is limited to 1–32 lanes and
duration to 1–300 seconds. A lane has at most one outstanding extraction, and a
run stops starting work after one million attempts. In-flight requests finish
under the existing adapter and engine limits. No queue or persistent session is
introduced.

Reports include corpus and artifact hashes, runtime versions, the configured
Worker isolate cap (null if unset), host architecture/CPU count,
load averages, actual elapsed time and recovery after the load. Each scenario
records attempted, admitted, capacity-rejected and failed extractions separately.
Admitted results must match the corpus; a failure or a scenario with no admitted
result makes the command fail. Capacity rejection is not successful throughput.
Per-scenario counts expose workload bias when admission rejects unevenly.

Latency retains at most the first 10,000 admitted samples per scenario and
reports its sample count, p50 and p95. Native RSS is a per-process peak. Worker
RSS samples the host process tree every 250 ms and includes the host runtime;
it is not an allocator measurement. Startup is outside the load interval.

Nimbo's Worker semaphore limits active pages within one isolate. Host limits
must also be explicit: celld v0.6.1 defaults its stateless isolate ceiling to the
available CPU count and permits `CELLD_MAX_STATELESS_ISOLATES` to override it.
See the [pinned host implementation](https://github.com/denoland/celld/blob/v0.6.1/crates/celld/runtime.rs#L435).
The runner inherits this external setting and does not change deployment
configuration. A single-isolate run and a multi-isolate run are different tests.

Sustained 120-second runs on 2026-10-14 used the build that adds the RTL
subset and the session API, on a 28-CPU x64 Linux host (1-minute load
average about 9 at the start, from processes outside this run):

| Host                           | Lanes | Attempted | Accepted | Accepted/s | Failures | p50–p95 range across scenarios | Memory                  |
| ------------------------------ | ----: | --------: | -------: | ---------: | -------: | ------------------------------ | ----------------------- |
| Native, fresh process per page |     4 |    16,671 |   16,671 |      138.9 |        0 | 19–57 ms / 24–68 ms            | 79 MiB peak per process |
| Worker, one isolate            |     8 |    86,378 |    2,544 |       21.2 |        0 | 40–123 ms / 79–180 ms          | host tree 402→563 MiB   |

The Worker isolate admits one active page, so excess client lanes are shed
immediately as capacity rejections. Nothing queues, and no admitted request
failed. Host process-tree RSS rose during warm-up and stayed level until the
end (562 MiB final versus a 563 MiB peak). The recovery extraction passed
after both runs. See the [native](evidence/native-load-sustained.json) and
[Worker](evidence/worker-load-sustained.json) reports. These local numbers
describe one machine, not production capacity.

Local results establish behavior on the measured host. They do not establish
production capacity, absence of memory leaks, or controlled performance
regression acceptance. Native session semantics and isolation are specified in [sessions](sessions.md).
Repeated rounds, idle retention and controlled-runner gates remain separate work.

The initial 30-second local reports cover all 12 corpus scenarios with four
native lanes and eight Worker client lanes (one Worker isolate). Each accepted
result matched the corpus and the recovery extraction passed. See the
[native report](evidence/native-load-local.json) and
[Worker report](evidence/worker-load-local.json). These runs shared the machine
with correctness validation; they are behavioral evidence, not accepted timing
baselines.
