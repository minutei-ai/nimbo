import { join } from "node:path";

export async function backgroundImagesFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/background-images-assets/")) {
    const variant = Number(path.slice("/background-images-assets/".length));
    return new Response(`#external{background-image:linear-gradient(red ${variant + 3}px,blue)}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/background-images/")) return undefined;
  const variant = Number(path.slice("/background-images/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/background-images.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/background-images-assets/${variant}"><script>${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
