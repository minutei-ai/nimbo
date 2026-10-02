import { join } from "node:path";

export async function canvasFixture(path: string): Promise<Response | undefined> {
  if (!path.startsWith("/canvas/")) return undefined;
  const script = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/canvas.txt"),
  ).text();
  const reference = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/canvas-compositing-reference.json"),
  ).text();
  return new Response(
    `<!doctype html><meta charset="utf-8"><script>const canvasCompositingReference=${reference};${script}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
