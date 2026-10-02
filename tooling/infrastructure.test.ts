import { expect, test } from "bun:test";
import { join } from "node:path";

test("project-local Alchemy CLI loads its pinned native dependency graph", async () => {
  const child = Bun.spawn(["bun", "alchemy", "--no-input", "--help"], {
    cwd: join(import.meta.dir, "../apps/infrastructure"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exit).toBe(0);
  // The pinned CLI prints a best-effort npm update notice on stderr, even for help.
  // Accept only that complete notice; dependency errors must still fail this check.
  if (error !== "") {
    const notice = error.match(
      /^alchemy (\d+\.\d+\.\d+(?:-[\w.-]+)?) is available \(you're on ([\w.-]+)\)\. Run `bun add alchemy@\1` to upgrade\.\r?\n$/,
    );
    expect(notice).not.toBeNull();
    const installed: unknown = await Bun.file(
      join(import.meta.dir, "../apps/infrastructure/node_modules/alchemy/package.json"),
    ).json();
    if (typeof installed !== "object" || installed === null) {
      throw new Error("Missing installed Alchemy metadata");
    }
    const version: unknown = Reflect.get(installed, "version");
    if (typeof version !== "string") throw new Error("Missing installed Alchemy version");
    expect(notice?.[2]).toBe(version);
  }
  expect(output).toContain("alchemy <subcommand>");
}, 15_000);
