import { join } from "node:path";
export async function fontFamilyFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/font-family-assets/")) {
    const variant = Number(path.slice("/font-family-assets/".length));
    return new Response(`#external{font-family:"External ${variant}",serif}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/font-family/")) return undefined;
  const variant = Number(path.slice("/font-family/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/font-family.txt"),
  ).text();
  return new Response(
    `<!doctype html><link rel="stylesheet" href="/font-family-assets/${variant}"><script>${script}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
