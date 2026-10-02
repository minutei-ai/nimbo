import { join } from "node:path";
export async function backgroundSizeFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/background-size-assets/")) {
    const variant = Number(path.slice("/background-size-assets/".length));
    return new Response(`#external{background-size:${variant + 3}px}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/background-size/")) return undefined;
  const variant = Number(path.slice("/background-size/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/background-size.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/background-size-assets/${variant}"><script>${script}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
