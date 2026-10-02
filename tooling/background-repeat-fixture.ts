import { join } from "node:path";

export async function backgroundRepeatFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/background-repeat-assets/")) {
    const variant = Number(path.slice("/background-repeat-assets/".length));
    return new Response(`#external{background-repeat:${variant % 2 ? "repeat-y" : "repeat-x"}}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/background-repeat/")) return undefined;
  const variant = Number(path.slice("/background-repeat/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/background-repeat.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/background-repeat-assets/${variant}"><script>${script}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
