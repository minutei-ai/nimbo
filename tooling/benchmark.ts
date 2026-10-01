import { Data, Effect } from "effect";

class BenchmarkError extends Data.TaggedError("BenchmarkError")<{
  readonly cause: unknown;
}> {}

const rows = "<li class=entry>row</li>".repeat(5_000);
const html = `<title>Static</title><main><ul>${rows}</ul></main>`;
const scenarios = [
  {
    name: "static",
    path: "/static",
    expression: "document.querySelector('.entry').textContent",
    expected: "row",
  },
  {
    name: "selectors-200",
    path: "/static",
    expression:
      "(() => { let value; for (let i = 0; i < 200; i++) value = document.querySelector('.entry').textContent; return value; })()",
    expected: "row",
  },
  { name: "dynamic-fetch", path: "/dynamic", expression: "document.title", expected: "Loaded" },
] as const;

const program = Effect.gen(function* () {
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          switch (new URL(request.url).pathname) {
            case "/api":
              return Response.json({ title: "Loaded" });
            case "/dynamic":
              return new Response(
                `${html}<script>fetch('/api').then(r => r.json()).then(data => document.title = data.title);</script>`,
                { headers: { "Content-Type": "text/html" } },
              );
            default:
              return new Response(html, { headers: { "Content-Type": "text/html" } });
          }
        },
      }),
    ),
    (fixtureServer) => Effect.promise(() => fixtureServer.stop(true)),
  );
  const report = yield* Effect.tryPromise({
    try: async () => {
      const binary = process.argv[2] ?? "target/release/nimbo-engine";
      const results = [];
      for (const scenario of scenarios) {
        const times = [];
        for (let iteration = 0; iteration < 24; iteration++) {
          const start = performance.now();
          const child = Bun.spawn(
            [binary, new URL(scenario.path, server.url).href, scenario.expression],
            { stdout: "pipe", stderr: "pipe" },
          );
          // Sequential runs avoid measuring competition between benchmark samples.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ]);
          const elapsed = performance.now() - start;
          const value: unknown = JSON.parse(stdout);
          if (code !== 0 || value !== scenario.expected)
            throw new Error(`invalid extraction: ${scenario.name}: ${stderr}`);
          if (iteration >= 3) times.push(elapsed);
        }
        times.sort((left, right) => left - right);
        results.push({
          scenario: scenario.name,
          samples: times.length,
          p50_ms: times[10],
          p95_ms: times[19],
          min_ms: times[0],
          max_ms: times[20],
        });
      }
      return {
        binary,
        mode: "one process per extraction; local HTTP; 5000 rows; 3 warmups",
        results,
      };
    },
    catch: (cause) => new BenchmarkError({ cause }),
  });
  yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`));
});

await Effect.runPromise(Effect.scoped(program));
