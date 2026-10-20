const program = await Bun.file(
  new URL("../crates/engine/tests/fixtures/fetch-json-hooks.txt", import.meta.url),
).text();

export async function fetchJsonHooksFixture(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (path === "/fetch-json-echo")
    return new Response(`${request.headers.get("x-example") ?? ""}|${await request.text()}`);
  if (path === "/fetch-json-hooks/bounds")
    return new Response("<!doctype html><body></body>", {
      headers: { "content-type": "text/html" },
    });
  const match = path.match(/^\/fetch-json-hooks\/(baseline|array|object|stringify)$/u);
  if (!match) return undefined;
  return new Response(
    `<!doctype html><body><script>globalThis.comparison=(${program})(${JSON.stringify(match[1])})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
