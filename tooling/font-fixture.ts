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
  const publicFont =
    /^\/public-font-assets\/(Liberation(?:Serif|Sans|Mono)-(?:Regular|Bold|Italic|BoldItalic)\.ttf)$/.exec(
      path,
    );
  if (publicFont?.[1])
    return new Response(
      Bun.file(join(import.meta.dir, "../target/font-reference/profile", publicFont[1])),
      { headers: { "content-type": "font/ttf" } },
    );
  if (path.startsWith("/font-profile/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-profile.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/rounded-box/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/rounded-box.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/atomic-inline/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/atomic-inline.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/text-baseline/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/text-baseline.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/font-settings/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-settings.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/authored-button/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/authored-button.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/anonymous-text/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/anonymous-text.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/order-layout/")) {
    const source = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/order-layout.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><body><script>globalThis.variant=${Number(path.split("/").at(-1))};${source}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/text-layout/")) {
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/text-layout.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><script>globalThis.variant=${Number(path.split("/").at(-1))};${script}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
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
