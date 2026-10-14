import { Schema } from "effect";
import { resolve } from "node:path";

const Ready = Schema.Struct({
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  version: Schema.String,
});

export async function startWorkerd(directory: string) {
  const token = crypto.randomUUID();
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      resolve(import.meta.dir, "benchmark-workerd-host.ts"),
      resolve(directory),
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, NIMBO_BENCH_HOST_TOKEN: token },
    },
  );
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await child.exited;
  };
  const deadline = AbortSignal.timeout(30000);
  const terminate = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  deadline.addEventListener("abort", terminate, { once: true });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes("\n")) {
      // The owned child emits one bounded readiness record, never page content.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done || text.length > 4096) throw new Error("Benchmark workerd startup failed");
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 4096) throw new Error("Benchmark workerd startup failed");
    }
    const ready = Schema.decodeUnknownSync(Ready)(JSON.parse(text.split("\n")[0] ?? ""));
    return {
      token,
      endpoint: new URL(`http://127.0.0.1:${ready.port}`),
      version: ready.version,
      pid: child.pid,
      stop,
    };
  } catch {
    await stop();
    throw new Error("Benchmark workerd startup failed");
  } finally {
    deadline.removeEventListener("abort", terminate);
    reader.releaseLock();
  }
}
