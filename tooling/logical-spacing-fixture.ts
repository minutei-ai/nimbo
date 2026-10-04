import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/logical-spacing.txt"),
).text();
export function logicalSpacingFixture(path: string): Response | undefined {
  if (path === "/logical-spacing-style")
    return new Response("#external{margin-inline-start:17px!important;padding-block-end:9px}", {
      headers: { "content-type": "text/css" },
    });
  const timed = path.startsWith("/logical-spacing-transitions/");
  if (!timed && !path.startsWith("/logical-spacing/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><link rel="stylesheet" href="/logical-spacing-style"><body><script>${source}\nglobalThis.comparison=${timed ? "logicalSpacingTransitionsCase" : "logicalSpacingCase"}(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
