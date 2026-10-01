import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function probeTypeScript(source: string, workspace = root) {
  const directory = await mkdtemp(join(workspace, ".lint-probe-"));
  try {
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({ extends: "../tsconfig.json", include: ["*.ts"] }),
    );
    const file = join(directory, "probe.ts");
    await writeFile(file, source);
    const process = Bun.spawn(["bun", "run", "lint:ts", "--no-ignore", file], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { output: stdout + stderr, exitCode };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("official Effect plugin accepts valid Effect v4 code", async () => {
  const result = await probeTypeScript(
    'import { Effect } from "effect"; export const program = Effect.succeed(42);',
  );
  expect(result.output).not.toContain("error");
  expect(result.exitCode).toBe(0);
});

test("Worker package resolves Effect and WebWorker types", async () => {
  const result = await probeTypeScript(
    'import { Effect } from "effect"; export const program = Effect.succeed(new Response("ok"));',
    join(root, "apps/worker"),
  );
  expect(result.output).not.toContain("error");
  expect(result.exitCode).toBe(0);
});

test("official Effect plugin rejects floating effects", async () => {
  const result = await probeTypeScript('import { Effect } from "effect"; Effect.succeed(42);');
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("floating-effect");
});

test("Go type checker rejects invalid TypeScript", async () => {
  const result = await probeTypeScript('export const value: number = "wrong";');
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("2322");
});

test("type-aware lint rejects unhandled promises", async () => {
  const result = await probeTypeScript("Promise.resolve(42);");
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("no-floating-promises");
});

test("Rust policy rejects unwrap and unsafe code", async () => {
  const directory = await mkdtemp(join(root, ".lint-probe-"));
  try {
    const manifest = await readFile(join(root, "Cargo.toml"), "utf8");
    const lints = manifest.slice(manifest.indexOf("[workspace.lints.rust]"));
    await writeFile(
      join(directory, "Cargo.toml"),
      '[package]\nname = "lint-probe"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n' +
        lints.replaceAll("[workspace.lints.", "[lints."),
    );
    await mkdir(join(directory, "src"));
    await writeFile(
      join(directory, "src/lib.rs"),
      "pub fn probe(value: Option<u8>) -> u8 { value.unwrap() }\npub unsafe fn forbidden() {}\n",
    );
    const process = Bun.spawn(
      ["cargo", "clippy", "--offline", "--all-targets", "--", "-D", "warnings"],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout + stderr).toContain("unwrap_used");
    expect(stdout + stderr).toContain("unsafe-code");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
