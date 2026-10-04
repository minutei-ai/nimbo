import { join } from "node:path";
export async function displayFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/display-assets/")) {
    const variant = Number(path.slice("/display-assets/".length));
    return new Response(`#external{display:${variant % 2 ? "inline-grid" : "inline-flex"}}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/display/")) return undefined;
  const variant = Number(path.slice("/display/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/display.txt"),
  ).text();
  return new Response(
    `<!doctype html><link rel="stylesheet" href="/display-assets/${variant}"><script>${script}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
