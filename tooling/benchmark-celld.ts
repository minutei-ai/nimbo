import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { benchmarkFixture } from "./benchmark-fixture";
import { runWorkerBenchmark } from "./benchmark-worker";

const binary = process.env.CELLD_BINARY ?? "celld";
const versionProcess = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" });
const [version, versionError, versionExit] = await Promise.all([
  new Response(versionProcess.stdout).text(),
  new Response(versionProcess.stderr).text(),
  versionProcess.exited,
]);
if (versionExit !== 0) throw new Error(`celld is unavailable: ${versionError}`);
const project = await mkdtemp(join(tmpdir(), "nimbo-celld-benchmark-"));
const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: benchmarkFixture });
const reservation = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("reserved"),
});
const port = reservation.port;
await reservation.stop(true);
const token = crypto.randomUUID();
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  await cp(resolve(import.meta.dir, "../dist/worker"), join(project, "worker"), {
    recursive: true,
  });
  await writeFile(
    join(project, "wrangler.json"),
    JSON.stringify({
      name: "nimbo-benchmark",
      main: "worker/index.js",
      compatibility_date: "2026-07-30",
      no_bundle: true,
    }),
  );
  await writeFile(join(project, ".dev.vars"), `API_TOKEN=${token}\n`, { mode: 0o600 });
  child = Bun.spawn(
    [binary, "dev", project, "--host", "127.0.0.1", "--port", String(port), "--no-watch"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const endpoint = new URL(`http://127.0.0.1:${port}`);
  const deadline = performance.now() + 45_000;
  let ready = false;
  while (performance.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`celld exited during startup (exit ${child.exitCode})`);
    try {
      // Poll the owned child until its listener is ready.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const response = await fetch(new URL("/health", endpoint), {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* The listener may not yet be bound. */
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("celld startup exceeded 45 seconds");
  const report = await runWorkerBenchmark(endpoint, fixture.url, token);
  process.stdout.write(
    `${JSON.stringify({ runtime: version.trim(), placement: "single local celld node; same prebuilt Worker/Wasm bundle", ...report }, null, 2)}\n`,
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await child.exited;
  }
  await fixture.stop(true);
  await rm(project, { recursive: true, force: true });
}
