import { Data, Effect } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";

class BuildError extends Data.TaggedError("BuildError")<{ readonly cause: unknown }> {}

const root = join(import.meta.dir, "..");
const command = (args: string[]) =>
  Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn(args, {
        cwd: root,
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          CC_wasm32_unknown_unknown: "clang",
          AR_wasm32_unknown_unknown: "llvm-ar",
        },
      });
      const code = await child.exited;
      if (code !== 0) throw new Error(`${args[0]} exited ${code}`);
    },
    catch: (cause) => new BuildError({ cause }),
  });

const build = Effect.gen(function* () {
  const bindgen = Bun.which("wasm-bindgen") ?? join(homedir(), ".cargo/bin/wasm-bindgen");
  yield* command([
    "cargo",
    "build",
    "-p",
    "nimbo-engine",
    "--lib",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "--locked",
  ]);
  yield* command([
    bindgen,
    "target/wasm32-unknown-unknown/release/nimbo_engine.wasm",
    "--target",
    "web",
    "--out-dir",
    "dist/wasm",
  ]);
  yield* Effect.tryPromise({
    try: async () => {
      const output = await Bun.build({
        entrypoints: [join(root, "apps/worker/src/index.ts")],
        outdir: join(root, "dist/worker"),
        target: "browser",
        format: "esm",
        minify: true,
        plugins: [
          {
            name: "worker-wasm",
            setup(builder) {
              builder.onResolve({ filter: /^env$/ }, () => ({
                path: join(root, "apps/worker/src/clock.ts"),
              }));
              builder.onResolve({ filter: /^nimbo:wasm$/ }, () => ({
                path: "./nimbo_engine_bg.wasm",
                external: true,
              }));
            },
          },
        ],
      });
      if (!output.success) throw new AggregateError(output.logs, "Worker bundle failed");
      await Bun.write(
        join(root, "dist/worker/nimbo_engine_bg.wasm"),
        Bun.file(join(root, "dist/wasm/nimbo_engine_bg.wasm")),
      );
    },
    catch: (cause) => new BuildError({ cause }),
  });
});

await Effect.runPromise(build);
