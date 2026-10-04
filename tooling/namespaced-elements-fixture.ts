import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/namespaced-elements.txt"),
).text();
export function namespacedElementsFixture(path: string): Response | undefined {
  if (!path.startsWith("/namespaced-elements/")) return undefined;
  return new Response(`<!doctype html><script>${source}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
