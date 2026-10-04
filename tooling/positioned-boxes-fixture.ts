import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/positioned-boxes.txt"),
).text();
export function positionedBoxesFixture(path: string): Response | undefined {
  if (!path.startsWith("/positioned-boxes/")) return undefined;
  return new Response(`<!doctype html><script>${source}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
