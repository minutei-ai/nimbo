import { join } from "node:path";

export async function borderFixture(path: string): Promise<Response | undefined> {
  if (!path.startsWith("/borders/")) return undefined;
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/borders.txt"),
  ).text();
  return new Response(`<!doctype html><meta charset="utf-8"><script>${script}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
