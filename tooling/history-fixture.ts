const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/history.txt", import.meta.url),
).text();
export function historyFixture(path: string, headers?: Headers): Response | undefined {
  if (!path.startsWith("/history/")) return undefined;
  if (path.endsWith(".css"))
    return new Response("body{color:rgb(1,2,3)}", { headers: { "content-type": "text/css" } });
  if (path.endsWith(".json"))
    return new Response(JSON.stringify({ path, cookie: headers?.get("cookie") ?? "" }), {
      headers: { "content-type": "application/json" },
    });
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><head><link rel="stylesheet" href="style.css"></head><body><script>const variant=${variant};${source}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
