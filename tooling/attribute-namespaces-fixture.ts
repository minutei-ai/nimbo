const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/attribute-namespaces.txt", import.meta.url),
).text();
export function attributeNamespacesFixture(path: string): Response | undefined {
  if (!path.startsWith("/attribute-namespaces/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><body><script>${source};globalThis.comparison=attributeNamespacesCase(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
