const expression = await Bun.file(
  new URL("../crates/engine/tests/fixtures/dom-implementation-has-feature.txt", import.meta.url),
).text();

export function domImplementationFixture(path: string): Response | undefined {
  if (!/^\/dom-implementation\/\d+$/u.test(path)) return undefined;
  return new Response(`<!doctype html><body><script>globalThis.comparison=${expression}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
