import { join } from "node:path";
const script = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/urls.txt"),
).text();
export function urlsFixture(path: string): Response | undefined {
  if (!/^\/urls\/\d+$/.test(path)) return undefined;
  return new Response(`<!doctype html><meta charset=utf-8><script>${script}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
