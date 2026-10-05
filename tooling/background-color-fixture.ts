const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/background-color.txt", import.meta.url),
).text();
export function backgroundColorFixture(path: string): Response | undefined {
  if (!path.startsWith("/background-color/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><body><script>${source};globalThis.comparison=backgroundColorCase(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
