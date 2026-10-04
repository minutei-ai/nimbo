import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}
class Connection {
  private next = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      const message: unknown = JSON.parse(event.data);
      const id = field(message, "id");
      if (typeof id !== "number") return;
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (field(message, "error")) request.reject(new Error("CDP command rejected"));
      else request.resolve(field(message, "result"));
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("CDP disconnected"));
      this.pending.clear();
    });
  }
  request(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout"));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close(): void {
    this.socket.close();
  }
}
async function connect(url: string): Promise<Connection> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), {
      once: true,
    });
  });
  return new Connection(socket);
}
export async function startCdpBrowser(kind: "chromium" | "obscura", binary: string) {
  const versionProcess = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
  const [binaryVersion, versionExit] = await Promise.all([
    new Response(versionProcess.stdout).text(),
    versionProcess.exited,
  ]);
  if (versionExit !== 0) throw new Error("Comparator binary is unavailable");
  const directory = await mkdtemp(join(tmpdir(), "nimbo-comparator-"));
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  const argumentsList =
    kind === "chromium"
      ? [
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--disable-background-networking",
          `--user-data-dir=${directory}`,
          `--remote-debugging-port=${port}`,
          "about:blank",
        ]
      : [
          "serve",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--allow-private-network",
          "--quiet",
        ];
  const child = Bun.spawn([binary, ...argumentsList], { stdout: "ignore", stderr: "ignore" });
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await child.exited;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    let identity: unknown;
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw new Error(`${kind} stopped during startup`);
      try {
        // Poll the owned comparator until its real CDP listener is ready.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          // oxlint-disable-next-line eslint/no-await-in-loop
          identity = await response.json();
          break;
        }
      } catch {
        /* Listener is not yet ready. */
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await Bun.sleep(100);
    }
    const endpoint = field(identity, "webSocketDebuggerUrl");
    const version = field(identity, "Browser");
    if (typeof endpoint !== "string" || typeof version !== "string")
      throw new Error("Invalid CDP discovery");
    return {
      version: binaryVersion.trim(),
      stop,
      async extract(url: string, expression: string): Promise<unknown> {
        const connection = await connect(endpoint);
        let targetId: string | undefined;
        try {
          const target = await connection.request("Target.createTarget", { url: "about:blank" });
          const created = field(target, "targetId");
          if (typeof created !== "string") throw new Error("Missing CDP target");
          targetId = created;
          const attached = await connection.request("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          const sessionId = field(attached, "sessionId");
          if (typeof sessionId !== "string") throw new Error("Missing CDP session");
          await connection.request("Page.enable", {}, sessionId);
          await connection.request("Page.navigate", { url }, sessionId);
          // A Promise waits for real document load without imposing a fixed settle delay.
          await connection.request(
            "Runtime.evaluate",
            {
              expression:
                "document.readyState === 'complete' ? true : new Promise(resolve => addEventListener('load', () => resolve(true), {once:true}))",
              awaitPromise: true,
              returnByValue: true,
            },
            sessionId,
          );
          const result = await connection.request(
            "Runtime.evaluate",
            { expression, awaitPromise: true, returnByValue: true },
            sessionId,
          );
          if (field(result, "exceptionDetails")) throw new Error("Comparator expression failed");
          return field(field(result, "result"), "value");
        } finally {
          try {
            if (targetId) await connection.request("Target.closeTarget", { targetId });
          } finally {
            connection.close();
          }
        }
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
