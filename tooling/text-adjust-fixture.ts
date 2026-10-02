import { join } from "node:path";

export async function textAdjustFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/text-adjust-assets/")) {
    const variant = Number(path.slice("/text-adjust-assets/".length));
    return new Response(`#external{text-size-adjust:${variant + 50}%}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/text-adjust/")) return undefined;
  const variant = Number(path.slice("/text-adjust/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/text-adjust.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/text-adjust-assets/${variant}"><script>${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
