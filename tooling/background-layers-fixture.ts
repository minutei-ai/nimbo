import { join } from "node:path";
export async function backgroundLayersFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/background-layers-assets/")) {
    const variant = Number(path.slice("/background-layers-assets/".length));
    return new Response(
      `#external{background-attachment:${variant % 2 ? "local" : "fixed"};background-origin:content-box;background-clip:padding-box}`,
      { headers: { "content-type": "text/css" } },
    );
  }
  if (!path.startsWith("/background-layers/")) return undefined;
  const variant = Number(path.slice("/background-layers/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/background-layers.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/background-layers-assets/${variant}"><script>${script}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
