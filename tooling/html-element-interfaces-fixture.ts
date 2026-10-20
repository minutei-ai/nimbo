const expression = await Bun.file(
  new URL("../crates/engine/tests/fixtures/html-element-interfaces.txt", import.meta.url),
).text();

export function htmlElementInterfacesFixture(path: string): Response | undefined {
  if (!/^\/html-element-interfaces\/\d+$/u.test(path)) return undefined;
  return new Response(`<!doctype html><body><script>globalThis.comparison=${expression}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
