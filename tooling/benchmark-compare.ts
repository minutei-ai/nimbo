import { startCelld } from "./benchmark-celld";
import { startCdpBrowser } from "./benchmark-cdp";
import { benchmarkFixture, benchmarkScenarios } from "./benchmark-fixture";

const scenarios = [
  ...benchmarkScenarios,
  {
    name: "static-5000",
    path: "/static?rows=5000",
    expression: benchmarkScenarios[0].expression,
    expected: "row",
  },
  {
    name: "selectors-200-5000",
    path: "/static?rows=5000",
    expression: benchmarkScenarios[1].expression,
    expected: "row",
  },
];
const fixtureRequests = new Map<string, number>();
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url),
      key = url.pathname + url.search;
    fixtureRequests.set(key, (fixtureRequests.get(key) ?? 0) + 1);
    return benchmarkFixture(request);
  },
});
let celld: Awaited<ReturnType<typeof startCelld>> | undefined;
const browsers: Awaited<ReturnType<typeof startCdpBrowser>>[] = [];
type Result = {
  runtime: string;
  scenario: string;
  valid: number;
  failures: Record<string, number>;
  samples_ms: number[];
};
const results: Result[] = [];
try {
  celld = await startCelld();
  const worker = celld;
  const obscura = await startCdpBrowser(
    "obscura",
    process.env.NIMBO_COMPARE_OBSCURA_BINARY ?? "obscura",
  );
  browsers.push(obscura);
  const chromium = await startCdpBrowser(
    "chromium",
    process.env.NIMBO_COMPARE_CHROMIUM_BINARY ?? "chromium",
  );
  browsers.push(chromium);
  const runtimes = [
    {
      name: "nimbo-celld",
      version: worker.version,
      mode: "persistent celld; fresh Nimbo page; authenticated HTTP API",
      async extract(url: string, expression: string): Promise<unknown> {
        const response = await fetch(new URL("/scrape", worker.endpoint), {
          method: "POST",
          headers: { authorization: `Bearer ${worker.token}`, "content-type": "application/json" },
          body: JSON.stringify({ url, expression }),
          signal: AbortSignal.timeout(30_000),
        });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (typeof result !== "object" || result === null)
          throw new Error("Invalid Worker response");
        return Reflect.get(result, "value");
      },
    },
    {
      name: "obscura",
      version: obscura.version,
      mode: "persistent public Obscura CDP server; fresh target and connection",
      extract: (url: string, expression: string) => obscura.extract(url, expression),
    },
    {
      name: "chromium",
      version: chromium.version,
      mode: "persistent unmodified headless Chromium; fresh target and connection; CDP",
      extract: (url: string, expression: string) => chromium.extract(url, expression),
    },
  ];
  for (const scenario of scenarios) {
    const entries: Result[] = runtimes.map(
      (runtime) =>
        ({
          runtime: runtime.name,
          scenario: scenario.name,
          valid: 0,
          failures: {},
          samples_ms: [],
        }) satisfies Result,
    );
    results.push(...entries);
    for (let iteration = 0; iteration < 24; iteration++) {
      for (let offset = 0; offset < runtimes.length; offset++) {
        const index = (iteration + offset) % runtimes.length,
          runtime = runtimes[index],
          entry = entries[index];
        if (!runtime || !entry) throw new Error("Missing benchmark runtime");
        const started = performance.now();
        try {
          // Rotated sequential runs avoid runtime competition and fixed ordering bias.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const value = await runtime.extract(
            new URL(scenario.path, fixture.url).href,
            scenario.expression,
          );
          const elapsed = performance.now() - started;
          if (value !== scenario.expected) throw new Error("Wrong extraction value");
          entry.valid++;
          if (iteration >= 3) entry.samples_ms.push(elapsed);
        } catch (error) {
          const category = error instanceof Error ? error.message : "Unknown failure";
          const failures: Record<string, number> = entry.failures;
          failures[category] = (failures[category] ?? 0) + 1;
        }
      }
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        mode: "real HTTP; concurrency 1; rotating runtime order; 3 excluded warmups and 21 measured attempts per scenario; persistent hosts; fresh extraction pages; no mocks",
        runtimes: runtimes.map(({ name, version, mode }) => ({ name, version, mode })),
        results: results.map(({ samples_ms, ...entry }) => {
          samples_ms.sort((a, b) => a - b);
          return Object.assign(entry, {
            measured: samples_ms.length,
            p50_ms: samples_ms.length ? samples_ms[Math.floor(samples_ms.length * 0.5)] : null,
            p95_ms: samples_ms.length ? samples_ms[Math.floor(samples_ms.length * 0.95)] : null,
          });
        }),
        fixture_requests: Object.fromEntries(fixtureRequests),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await Promise.all(browsers.map((browser) => browser.stop()));
  if (celld) await celld.stop();
  await fixture.stop(true);
}
