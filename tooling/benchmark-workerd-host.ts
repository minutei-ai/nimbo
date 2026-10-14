import { Schema } from "effect";
import { dirname, join, resolve } from "node:path";
import { Miniflare } from "miniflare";

const directory = process.argv[2];
const token = process.env.NIMBO_BENCH_HOST_TOKEN;
if (!directory || !token) throw new Error("Missing benchmark host configuration");
const manifest = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }));
const miniflare = manifest(
  await Bun.file(Bun.resolveSync("miniflare/package.json", import.meta.dir)).json(),
);
const workerd = manifest(
  await Bun.file(
    Bun.resolveSync("workerd/package.json", dirname(Bun.resolveSync("miniflare", import.meta.dir))),
  ).json(),
);
const worker = new Miniflare({
  modules: [
    { type: "ESModule", path: join(resolve(directory), "index.js") },
    { type: "CompiledWasm", path: join(resolve(directory), "nimbo_engine_bg.wasm") },
  ],
  compatibilityDate: "2026-07-30",
  bindings: { API_TOKEN: token },
});
let server: ReturnType<typeof Bun.serve> | undefined;
process.once("SIGTERM", () => {
  void Promise.resolve(server?.stop(true))
    .then(() => worker.dispose())
    .catch(() => {
      process.exitCode = 1;
    });
});
await worker.ready;
server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const response = await worker.dispatchFetch(`https://nimbo.test${url.pathname}`, {
      method: request.method,
      signal: request.signal,
      headers: Object.fromEntries(request.headers),
      ...(request.method === "GET" || request.method === "HEAD"
        ? {}
        : { body: await request.arrayBuffer() }),
    });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  },
});
process.stdout.write(
  `${JSON.stringify({ port: server.port, version: `workerd ${workerd.version}; Miniflare ${miniflare.version}` })}\n`,
);
