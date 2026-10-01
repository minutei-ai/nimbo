import { expect, test } from "bun:test";
import { join } from "node:path";

test("project-local Alchemy CLI loads its pinned native dependency graph", async () => {
  const child = Bun.spawn(["bun", "alchemy", "--help"], {
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
  expect(error).toBe("");
  expect(output).toContain("alchemy <subcommand>");
}, 15_000);
