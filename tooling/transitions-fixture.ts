import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/transitions.txt"),
).text();
export function transitionsFixture(path: string): Response | undefined {
  if (!path.startsWith("/transitions/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><body><script>${source}\nglobalThis.comparison=transitionsCase(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
