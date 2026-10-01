import { Data, Effect } from "effect";

class BuildError extends Data.TaggedError("BuildError")<{ readonly cause: unknown }> {}

const build = Effect.tryPromise({
  try: async () => {
    const output = process.argv[2];
    if (!output) throw new Error("missing Cargo OUT_DIR output path");
    const source = await Bun.file(new URL("../crates/engine/src/web.ts", import.meta.url)).text();
    // Preserve the IIFE's return value: Rust receives the lifecycle callback.
    const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
    // Bun removes redundant directives; QuickJS evaluates this as a script.
    await Bun.write(output, `"use strict";\n${transpiler.transformSync(source)}`);
  },
  catch: (cause) => new BuildError({ cause }),
});

await Effect.runPromise(build);
