import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/custom-boxes.txt"),
).text();
export function customBoxesFixture(path: string): Response | undefined {
  if (!path.startsWith("/custom-boxes/")) return undefined;
  return new Response(`<script>${source}</script>`, { headers: { "content-type": "text/html" } });
}
