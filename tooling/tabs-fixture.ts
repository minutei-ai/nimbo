import { join } from "node:path";

export async function tabsFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/tabs-assets/")) {
    const variant = Number(path.slice("/tabs-assets/".length));
    return new Response(`#external{tab-size:${variant + 3}px}`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/tabs/")) return undefined;
  const variant = Number(path.slice("/tabs/".length));
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/tabs.txt"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/tabs-assets/${variant}"><script>${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
