import { join } from "node:path";

export async function backgroundPositionFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/background-position-assets/")) {
    const variant = Number(path.slice("/background-position-assets/".length));
    return new Response(`#external{background-position:${variant + 3}px 20%}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/background-position/")) return undefined;
  const variant = Number(path.slice("/background-position/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/background-position.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/background-position-assets/${variant}"><script>${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
