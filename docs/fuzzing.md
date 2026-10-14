# Fuzzing

`fuzz/` holds a libFuzzer target over the owned engine, built only under
`cfg(fuzzing)` and absent from ordinary artifacts. The first input byte picks a
mode; the rest is malformed HTML, CSS, a selector, an import map or a JavaScript
expression. Pages run with reduced limits and every subrequest is rejected, so a
campaign never touches the network. After each input a fresh page must start
clean: no leaked globals, storage, cookies or prototype changes.

Expected input errors are accepted. Crashes, sanitizer reports, I/O/HTTP errors,
timeouts above 15 s, RSS above 1 GiB and a failed fresh page are findings.

## Running

```sh
cargo install cargo-fuzz --locked
cargo +nightly-2026-04-29 fuzz run engine fuzz/corpus/engine fuzz/seeds -- \
  -runs=10000 -seed=20261015 -max_len=8192 -timeout=15 -rss_limit_mb=1024 \
  -artifact_prefix=fuzz/artifacts/
```

The manual `Fuzz campaign` workflow (`.github/workflows/fuzz.yml`) runs the same
command with configurable runs and seed, and uploads `fuzz/artifacts/` on
failure. The generated corpus and artifacts stay untracked; reduced findings
become seeds under `fuzz/seeds/` and a regression test in the engine.

## Campaign record

2026-10-14, commit `6b950a5`, Linux x86_64, `rustc 1.97.0-nightly
(37d85e592 2026-04-28)`, cargo-fuzz 0.13.2, ASan, the command above:

|  Runs |  Time |      Coverage |      Features |             Corpus | Peak RSS | Findings |
| ----: | ----: | ------------: | ------------: | -----------------: | -------: | -------: |
| 10000 | 901 s | 15625 → 21263 | 20263 → 42277 | 8 → 1383 (107 KiB) |  555 MiB |        0 |

No crash, leak, timeout, RSS or fresh-page failure was reported, so no
regression test was added. Throughput was 11 exec/s and libFuzzer's length
limit grew only to 132 bytes, so this campaign mostly exercised short inputs;
longer runs or larger seeds are needed for deep CSS/layout and script inputs.
A clean campaign is evidence for these inputs only, not proof of absence.
