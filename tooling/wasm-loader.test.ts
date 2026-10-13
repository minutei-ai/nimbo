import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";

test("native Wasm loader closes failed construction and transfers ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nimbo-loader-test-"));
  let worker: Miniflare | undefined;
  try {
    const output = await Bun.build({
      entrypoints: [join(import.meta.dir, "../apps/worker/src/fixtures/wasm-loader.ts")],
      outdir: directory,
      target: "browser",
      format: "esm",
      minify: true,
      plugins: [
        {
          name: "native-clock",
          setup(builder) {
            builder.onResolve({ filter: /^env$/ }, () => ({
              path: join(import.meta.dir, "../apps/worker/src/clock.ts"),
            }));
            builder.onResolve({ filter: /^nimbo:wasm$/ }, () => ({
              path: "./nimbo_engine_bg.wasm",
              external: true,
            }));
          },
        },
      ],
    });
    if (!output.success) throw new AggregateError(output.logs, "loader fixture build failed");
    const wasmPath = join(directory, "nimbo_engine_bg.wasm");
    await Bun.write(
      wasmPath,
      Bun.file(join(import.meta.dir, "../dist/worker/nimbo_engine_bg.wasm")),
    );
    worker = new Miniflare({
      modulesRoot: directory,
      modules: [
        { type: "ESModule", path: join(directory, "wasm-loader.js") },
        {
          type: "CompiledWasm",
          path: wasmPath,
        },
      ],
      compatibilityDate: "2026-07-30",
    });
    const response = await worker.dispatchFetch("https://example.test/");
    expect(response.status).toBe(200);
    const value: unknown = await response.json();
    expect(value).toEqual({
      oversizedChunkClosed: true,
      exhaustedBytesClosed: true,
      nodeQuotaClosed: true,
      transferSurvivesLoaderDisposal: true,
      synchronousConstructor: true,
    });
  } finally {
    await worker?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
