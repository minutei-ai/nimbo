const source = await Bun.file(
  new URL("../crates/engine/tests/fixtures/document-stylesheets.txt", import.meta.url),
).text();
export function documentStylesheetsFixture(path: string): Response | undefined {
  if (path === "/document-stylesheets-assets/missing.css")
    return new Response("Missing", { status: 404, headers: { "content-type": "text/css" } });
  if (path === "/document-stylesheets-assets/wrong-mime.css")
    return new Response("#box { width: 999px }", {
      headers: { "content-type": "text/plain", "x-content-type-options": "nosniff" },
    });
  if (path.startsWith("/document-stylesheets-assets/")) {
    const variant = Number(path.split("/").at(-1)?.replace(".css", ""));
    return new Response(`#box { width: ${30 + variant}px }`, {
      headers: { "content-type": "text/css" },
    });
  }
  if (!path.startsWith("/document-stylesheets/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><head><style id=inline>#box { width:20px }</style><link id=external rel=stylesheet href=/document-stylesheets-assets/${variant}.css><link id=failed rel=stylesheet href=/document-stylesheets-assets/missing.css><link id=wrong-mime rel=stylesheet href=/document-stylesheets-assets/wrong-mime.css><link id=reference rel=help href=https://example.com></head><body><div id=box></div><script>${source};globalThis.comparison=documentStylesheetsCase(${variant})</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
