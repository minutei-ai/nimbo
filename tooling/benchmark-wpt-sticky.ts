import { Schema } from "effect";
import { startCelld } from "./benchmark-celld";
import { startCdpBrowser } from "./benchmark-cdp";
import { createWptStickyFixture } from "./wpt-sticky-fixture";
import sources from "./wpt-sticky-sources.json";

const root = process.env.NIMBO_WPT_REFERENCE_ROOT;
if (!root) throw new Error("Set NIMBO_WPT_REFERENCE_ROOT to the original pinned WPT files");
const chromium = process.env.NIMBO_COMPARE_CHROMIUM_BINARY;
if (!chromium) throw new Error("Set NIMBO_COMPARE_CHROMIUM_BINARY to ordinary Chromium");
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
const decode = Schema.decodeUnknownSync(Verdict);
const files = sources.files.filter(({ path }) => path.endsWith(".html")).map(({ path }) => path);
const expression =
  "new Promise(resolve=>{function poll(){if(globalThis.wptResult!==null&&globalThis.wptResult!==undefined)resolve(globalThis.wptResult);else setTimeout(poll,10)}poll()})";
type Row = {
  runtime: string;
  file: string;
  status: "passed" | "failed" | "incomplete";
  verdict?: typeof Verdict.Type;
  error?: string;
};
const results: Row[] = [];
const fixture = await createWptStickyFixture(root);
let browser: Awaited<ReturnType<typeof startCdpBrowser>> | undefined;
let runtime: Awaited<ReturnType<typeof startCelld>> | undefined;
let obscura: Awaited<ReturnType<typeof startCdpBrowser>> | undefined;
const record = (row: Row, value: unknown) => {
  row.verdict = decode(value);
  row.status =
    row.verdict.status === 0 &&
    row.verdict.total > 0 &&
    row.verdict.passed === row.verdict.total &&
    !row.verdict.failed.length
      ? "passed"
      : "failed";
};
try {
  browser = await startCdpBrowser("chromium", chromium);
  runtime = await startCelld();
  const comparator = process.env.NIMBO_COMPARE_OBSCURA_BINARY;
  if (comparator) obscura = await startCdpBrowser("obscura", comparator);
  for (const file of files) {
    const url = new URL(file, fixture.url).href;
    const control: Row = { runtime: browser.version, file, status: "incomplete" };
    results.push(control);
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop
      record(control, await browser.extract(url, expression));
    } catch (error) {
      control.error = String(error);
    }
    if (obscura) {
      const reference: Row = { runtime: obscura.version, file, status: "incomplete" };
      results.push(reference);
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop
        record(reference, await obscura.extract(url, expression));
      } catch (error) {
        reference.error = String(error);
      }
    }
    const candidate: Row = { runtime: runtime.version, file, status: "incomplete" };
    results.push(candidate);
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const response = await fetch(new URL("/scrape", runtime.endpoint), {
        method: "POST",
        headers: { authorization: `Bearer ${runtime.token}`, "content-type": "application/json" },
        body: JSON.stringify({ url, expression }),
      });
      // oxlint-disable-next-line eslint/no-await-in-loop
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null) throw new Error("Missing engine response");
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${String(Reflect.get(body, "error"))}`);
      record(candidate, Reflect.get(body, "value"));
    } catch (error) {
      candidate.error = String(error);
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        source: "https://github.com/web-platform-tests/wpt",
        source_commit: sources.commit,
        files,
        scope:
          "Four original CSS sticky HTML files, helper and testharness; original vendor integration script plus reporting-only append; output/message events disabled; real HTTP; default engine limits; no mocks",
        results,
      },
      null,
      2,
    )}\n`,
  );
  if (results.some((row) => row.status !== "passed")) process.exitCode = 1;
} finally {
  try {
    try {
      if (obscura) await obscura.stop();
    } finally {
      if (runtime) await runtime.stop();
    }
  } finally {
    try {
      if (browser) await browser.stop();
    } finally {
      await fixture.stop(true);
    }
  }
}
