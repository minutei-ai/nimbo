import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/z-index.txt"),
).text();
export function zIndexFixture(path: string): Response | undefined {
  if (path === "/z-index-style")
    return new Response("#external{z-index:29!important}", {
      headers: { "content-type": "text/css" },
    });
  if (!path.startsWith("/z-index/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><link rel="stylesheet" href="/z-index-style"><body><script>${source}\nglobalThis.comparison=zIndexCase(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
