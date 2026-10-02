import { join } from "node:path";

export async function lineHeightFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/line-height-assets/")) {
    const variant = Number(path.slice("/line-height-assets/".length));
    return new Response(`#external{line-height:${variant + 3}px}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/line-height/")) return undefined;
  const variant = Number(path.slice("/line-height/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/line-height.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/line-height-assets/${variant}"><script>${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
