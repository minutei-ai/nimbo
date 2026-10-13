const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/mutation-observer.txt", import.meta.url),
).text();
export function mutationObserverFixture(path: string): Response | undefined {
  if (!path.startsWith("/mutation-observer/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(`<!doctype html><body><script>const variant=${variant};${source}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
