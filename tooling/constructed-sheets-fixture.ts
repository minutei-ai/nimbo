import { join } from "node:path";
export async function constructedSheetsFixture(path: string): Promise<Response | undefined> {
  if (!path.startsWith("/constructed-sheets/")) return undefined;
  const source = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/constructed-sheets.txt"),
  ).text();
  return new Response(`<!doctype html><script>${source}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
