import { join } from "node:path";
export async function htmlBoxesFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/html-boxes-assets/")) {
    const variant = Number(path.slice("/html-boxes-assets/".length));
    return new Response(
      `#external{display:block;width:${variant + 7}px;height:${(variant % 6) + 3}px}`,
      { headers: { "content-type": "text/css" } },
    );
  }
  if (!path.startsWith("/html-boxes/")) return undefined;
  const variant = Number(path.slice("/html-boxes/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/html-boxes.txt"),
  ).text();
  return new Response(
    `<!doctype html><link rel="stylesheet" href="/html-boxes-assets/${variant}"><script>${script}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
