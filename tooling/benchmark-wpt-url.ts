import { Schema } from "effect";
import sources from "./wpt-url-sources.json";
import { startCelld } from "./benchmark-celld";
import { createWptUrlFixture } from "./wpt-url-fixture";
const root = process.env.NIMBO_WPT_REFERENCE_ROOT;
if (!root) throw new Error("Set NIMBO_WPT_REFERENCE_ROOT to the original WPT source directory");
const { fixture, cases } = await createWptUrlFixture(root);
const Verdict = Schema.Struct({
  status: Schema.Int,
  message: Schema.NullOr(Schema.String),
  total: Schema.Int,
  passed: Schema.Int,
  failed: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.Int,
      message: Schema.NullOr(Schema.String),
    }),
  ),
});
type Row = {
  file: string;
  variant: string;
  status: "passed" | "failed" | "incomplete";
  verdict?: typeof Verdict.Type;
  error?: string;
};
const results: Row[] = [];
let runtime: Awaited<ReturnType<typeof startCelld>> | undefined;
try {
  runtime = await startCelld();
  for (const item of cases) {
    const row: Row = { file: item.path.slice(1), variant: item.variant, status: "incomplete" };
    results.push(row);
    try {
      // Poll only the original harness completion callback; retain its status and every assertion failure.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const response = await fetch(new URL("/scrape", runtime.endpoint), {
        method: "POST",
        headers: { authorization: `Bearer ${runtime.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          url: new URL(item.path.replace(/\.any\.js$/, ".any.html") + item.variant, fixture.url)
            .href,
          expression:
            "new Promise(resolve=>{function poll(){if(globalThis.wptResult!==null)resolve(globalThis.wptResult);else setTimeout(poll,10)}poll()})",
        }),
        signal: AbortSignal.timeout(120_000),
      });
      // oxlint-disable-next-line eslint/no-await-in-loop
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null) throw new Error("Missing engine response");
      if (!response.ok)
        throw new Error(String(Reflect.get(body, "error") ?? `HTTP ${response.status}`));
      const value: unknown = Reflect.get(body, "value");
      const verdict = Schema.decodeUnknownSync(Verdict)(
        typeof value === "string" ? JSON.parse(value) : value,
      );
      row.verdict = verdict;
      row.status =
        verdict.status === 0 && verdict.total > 0 && verdict.passed === verdict.total
          ? "passed"
          : "failed";
    } catch (error) {
      row.error =
        error instanceof Error
          ? (error.message.split("\n")[0] ?? "Unknown failure")
          : "Unknown failure";
    }
    process.stderr.write(
      `${row.file}${row.variant}: ${row.status} ${row.verdict?.passed ?? 0}/${row.verdict?.total ?? 0}\n`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        source: sources.repository,
        source_commit: sources.commit,
        runtime: runtime.version,
        mode: "Nimbo own Worker/Wasm engine inside celld; original WPT testharness, assertions, data and META variants; real HTTP; default engine limits; no mocks",
        scope:
          "Pinned url/*.any.js window-global variants only; dedicated-worker and other URL .html/.window.js/.xhtml tests remain pending. Generated HTML follows META scripts/variants/long timeout; output disabled and message events disabled for callback reporting. This adapter is not the complete WPT server or a full URL-suite pass.",
        files: new Set(cases.map((item) => item.path)).size,
        variants: cases.length,
        passed_variants: results.filter((row) => row.status === "passed").length,
        failed_variants: results.filter((row) => row.status === "failed").length,
        incomplete_variants: results.filter((row) => row.status === "incomplete").length,
        completed_tests: results.reduce((total, row) => total + (row.verdict?.total ?? 0), 0),
        passed_tests: results.reduce((total, row) => total + (row.verdict?.passed ?? 0), 0),
        results,
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
