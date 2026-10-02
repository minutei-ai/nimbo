import { join } from "node:path";

export async function outlineFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/outline-assets/")) {
    const variant = Number(path.slice("/outline-assets/".length));
    return new Response(
      `#external{outline:${variant + 2}px solid red;outline-offset:${variant + 1}px}`,
      {
        headers: { "content-type": "text/css" },
      },
    );
  }
  if (!path.startsWith("/outlines/")) return undefined;
  const variant = Number(path.slice("/outlines/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/outlines.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/outline-assets/${variant}"><script>${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
