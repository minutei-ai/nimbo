import { join } from "node:path";

export async function logicalSizeFixture(path: string): Promise<Response | undefined> {
  if (!path.startsWith("/logical-size/")) return undefined;
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/logical-size.txt"),
  ).text();
  return new Response(`<!doctype html><meta charset="utf-8"><script>${script}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
