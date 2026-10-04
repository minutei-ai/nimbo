import { realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Schema } from "effect";
import { startCelld } from "./benchmark-celld";

const referenceCommit = "2d7bc304fbb7ebefc44f770938192e3cede87dbd";
const Stage = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  category: Schema.String,
  type: Schema.optional(Schema.Literals(["eval", "dump"])),
  check: Schema.optional(Schema.String),
  expect: Schema.optional(Schema.String),
});
const Manifest = Schema.Struct({
  stages: Schema.Array(Stage),
  wait_secs: Schema.Int,
  timeout_secs: Schema.Int,
  warmup: Schema.Int,
  runs: Schema.Int,
});
const ResponseBody = Schema.Struct({
  value: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});
const referenceRoot = process.env.NIMBO_BENCH_REFERENCE_ROOT;
if (!referenceRoot)
  throw new Error("Set NIMBO_BENCH_REFERENCE_ROOT to the public benchmark checkout");
const git = Bun.spawn(["git", "-C", referenceRoot, "rev-parse", "HEAD"], {
  stdout: "pipe",
  stderr: "ignore",
});
const [commit, exit] = await Promise.all([new Response(git.stdout).text(), git.exited]);
if (exit !== 0 || commit.trim() !== referenceCommit)
  throw new Error("Public benchmark revision mismatch");
const changes = Bun.spawn(["git", "-C", referenceRoot, "status", "--porcelain"], {
  stdout: "pipe",
  stderr: "ignore",
});
const [dirty, statusExit] = await Promise.all([
  new Response(changes.stdout).text(),
  changes.exited,
]);
if (statusExit !== 0 || dirty.trim()) throw new Error("Public benchmark checkout must be clean");
const root = await realpath(join(referenceRoot, "obstacle-course"));
const manifest = Schema.decodeUnknownSync(Manifest)(
  await Bun.file(join(root, "manifest.json")).json(),
);
const runs = Number(process.env.NIMBO_OBSTACLE_RUNS ?? manifest.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 100)
  throw new Error("Runs must be 1 through 100");
const requests = new Map<string, number>();
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const file = await realpath(resolve(root, `.${pathname}`));
      if (!file.startsWith(root + sep)) return new Response("Not found", { status: 404 });
      requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
      const body = Bun.file(file);
      // Upstream SimpleHTTPRequestHandler sends a MIME type without a forced UTF-8 charset.
      return new Response(body, {
        headers: {
          "cache-control": "no-store",
          "content-type": body.type.split(";")[0] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
});
type Row = {
  stage: string;
  category: string;
  status: "passed" | "failed" | "adapter-missing";
  attempts: number;
  valid: number;
  failures: Record<string, number>;
  samples_ms: number[];
  last_value: unknown;
};
const results: Row[] = [];
let runtime: Awaited<ReturnType<typeof startCelld>> | undefined;
try {
  runtime = await startCelld();
  for (const stage of manifest.stages) {
    const row: Row = {
      stage: stage.name,
      category: stage.category,
      status: stage.type === "dump" ? "adapter-missing" : "failed",
      attempts: 0,
      valid: 0,
      failures: {},
      samples_ms: [],
      last_value: null,
    };
    results.push(row);
    if (stage.type === "dump") continue;
    if (!stage.check || stage.expect === undefined) throw new Error("Invalid eval stage contract");
    // Preserve the upstream explicit post-load delay and original expression.
    // A real page timer supplies that delay through Nimbo's existing event loop.
    const expression = `new Promise((resolve,reject)=>setTimeout(()=>{try{resolve(${stage.check})}catch(error){reject(error)}},${manifest.wait_secs * 1000}))`;
    for (let iteration = 0; iteration < runs + manifest.warmup; iteration++) {
      row.attempts++;
      const started = performance.now();
      try {
        // Sequential fresh pages keep the default isolate capacity and limits.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await fetch(new URL("/scrape", runtime.endpoint), {
          method: "POST",
          headers: { authorization: `Bearer ${runtime.token}`, "content-type": "application/json" },
          body: JSON.stringify({ url: new URL(stage.file, fixture.url).href, expression }),
          signal: AbortSignal.timeout(manifest.timeout_secs * 1000),
        });
        // oxlint-disable-next-line eslint/no-await-in-loop
        const body = Schema.decodeUnknownSync(ResponseBody)(await response.json());
        if (!response.ok)
          throw new Error(`HTTP ${response.status}: ${body.error ?? "request failed"}`);
        row.last_value = body.value;
        if (body.value !== JSON.stringify(stage.expect))
          throw new Error("Upstream expectation mismatch");
        row.valid++;
        if (iteration >= manifest.warmup) row.samples_ms.push(performance.now() - started);
      } catch (error) {
        const reason =
          error instanceof Error
            ? (error.message.split("\n")[0] ?? "Unknown failure")
            : "Unknown failure";
        row.failures[reason] = (row.failures[reason] ?? 0) + 1;
      }
    }
    if (row.valid === row.attempts) row.status = "passed";
    process.stderr.write(`${row.stage}: ${row.status} ${row.valid}/${row.attempts}\n`);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        source: "https://github.com/h4ckf0r0day/obscura-benchmark",
        source_commit: referenceCommit,
        runtime: runtime.version,
        mode: "Nimbo own Wasm engine; real upstream HTTP fixtures and assertions; original manifest settle delay and timeout; default limits; sequential fresh pages; validated warmups; no mocks",
        parameters: {
          runs,
          warmup: manifest.warmup,
          wait_secs: manifest.wait_secs,
          timeout_secs: manifest.timeout_secs,
        },
        fixture_transport:
          "Real HTTP; upstream fixture bytes; MIME media types without Bun implicit UTF-8 charset; no-store adapter; persistent host",
        timing_scope:
          "HTTP control, fresh page, fixture execution, original post-load delay, extraction and cleanup; not upstream cold CLI timings",
        results,
        origin_requests: Object.fromEntries(
          [...requests.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
        ),
      },
      null,
      2,
    )}\n`,
  );
  if (results.some((row) => row.status !== "passed")) process.exitCode = 1;
} finally {
  if (runtime) await runtime.stop();
  await fixture.stop(true);
}
