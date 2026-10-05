const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/layout-snapshot.txt", import.meta.url),
).text();
export function layoutSnapshotFixture(path: string): Response | undefined {
  if (!path.startsWith("/layout-snapshot/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><body><script>${source};globalThis.comparison=layoutSnapshotCase(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
