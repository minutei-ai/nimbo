import { Schema } from "effect";
import { startCelld } from "./benchmark-celld";
import { startCdpBrowser } from "./benchmark-cdp";

export async function compareCssContracts(
  serve: (path: string) => Response | undefined,
  route: string,
  fixturePath: string,
  expectedCount: number,
  scope: string,
) {
  const binary = process.env.NIMBO_COMPARE_CHROMIUM_BINARY;
  if (!binary) throw new Error("Set NIMBO_COMPARE_CHROMIUM_BINARY to ordinary Chromium");
  const decode = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean));
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      serve(new URL(request.url).pathname) ?? new Response("Not found", { status: 404 }),
  });
  let browser: Awaited<ReturnType<typeof startCdpBrowser>> | undefined;
  let celld: Awaited<ReturnType<typeof startCelld>> | undefined;
  const results: {
    runtime: string;
    variant: number;
    status: string;
    checks?: Record<string, boolean>;
    error?: string;
  }[] = [];
  try {
    browser = await startCdpBrowser("chromium", binary);
    celld = await startCelld();
    for (const runtime of [browser.version, celld.version]) {
      for (let variant = 0; variant < 64; variant++) {
        const row: (typeof results)[number] = { runtime, variant, status: "incomplete" };
        results.push(row);
        const url = new URL(`${route}/${variant}`, fixture.url).href;
        try {
          let value: unknown;
          if (runtime === browser.version) {
            // oxlint-disable-next-line eslint/no-await-in-loop
            value = await browser.extract(url, "globalThis.comparison");
          } else {
            // oxlint-disable-next-line eslint/no-await-in-loop
            const response = await fetch(new URL("/scrape", celld.endpoint), {
              method: "POST",
              headers: {
                authorization: `Bearer ${celld.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ url, expression: "globalThis.comparison" }),
            });
            // oxlint-disable-next-line eslint/no-await-in-loop
            const body: unknown = await response.json();
            if (!response.ok || typeof body !== "object" || body === null)
              throw new Error(`HTTP ${response.status}`);
            value = Reflect.get(body, "value");
          }
          row.checks = decode(value);
          row.status =
            Object.keys(row.checks).length === expectedCount &&
            Object.values(row.checks).every(Boolean)
              ? "passed"
              : "failed";
        } catch (error) {
          row.error = String(error);
        }
      }
    }
    process.stdout.write(
      `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), fixture: fixturePath, scope, results }, null, 2)}\n`,
    );
    if (results.some((row) => row.status !== "passed")) process.exitCode = 1;
  } finally {
    try {
      if (celld) await celld.stop();
    } finally {
      try {
        if (browser) await browser.stop();
      } finally {
        await fixture.stop(true);
      }
    }
  }
}
