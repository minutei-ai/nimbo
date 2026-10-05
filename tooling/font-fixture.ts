import { join } from "node:path";

export async function fontFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/font-shaping-assets/"))
    return new Response(
      Bun.file(join(import.meta.dir, "../crates/engine/tests/fixtures/synthetic-shaping-font.ttf")),
      { headers: { "content-type": "font/ttf" } },
    );
  if (path.startsWith("/font-loading/font/") || path.startsWith("/font-assets/font/"))
    return new Response(
      Bun.file(join(import.meta.dir, "../crates/engine/tests/fixtures/synthetic-font.ttf")),
      { headers: { "content-type": "font/ttf" } },
    );
  if (path.startsWith("/font-assets/redirect/"))
    return new Response(null, {
      status: 302,
      headers: { location: `/font-assets/styles/entry-${path.split("/").at(-1)}.css` },
    });
  if (path.startsWith("/font-assets/styles/entry-")) {
    const variant = Number(path.split("entry-").at(-1)?.split(".css")[0]);
    return new Response(
      `@font-face{font-family:NimboCSS${variant};src:url('../font/${variant}');font-style:italic;font-weight:700;font-display:swap}`,
      { headers: { "content-type": "text/css" } },
    );
  }
  if (path.startsWith("/font-assets/invalid/")) return new Response(new Uint8Array([1, 2, 3]));
  if (path.startsWith("/font-assets/missing/")) return new Response("missing", { status: 404 });
  if (path.startsWith("/font-shaping/")) {
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-shaping.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><script>globalThis.variant=${Number(path.split("/").at(-1))};${script}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/font-matching/")) {
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-matching.txt"),
    ).text();
    return new Response(`<!doctype html><meta charset="utf-8"><script>${script}</script>`, {
      headers: { "content-type": "text/html" },
    });
  }
  if (path.startsWith("/font-loading/")) {
    const variant = Number(path.split("/").at(-1));
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-loading.txt"),
    ).text();
    return new Response(
      `<!doctype html><link rel="stylesheet" href="/font-assets/redirect/${variant}"><style>@font-face{font-family:NimboInline${variant};src:url('/font-assets/font/${variant}')}@font-face{src:url('/font-assets/missing/${variant}')}#geometry{width:${variant + 30}px;height:10px}</style><div id="geometry"></div><script>${script}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  return undefined;
}
