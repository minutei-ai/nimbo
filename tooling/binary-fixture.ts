import { join } from "node:path";

export function binaryFixture(path: string): Response | undefined {
  if (!path.startsWith("/binary/")) return undefined;
  const headers = { "content-type": "application/octet-stream" };
  if (path.startsWith("/binary/data/")) {
    const variant = Number(path.split("/").at(-1));
    return new Response(
      Uint8Array.from({ length: 512 }, (_, i) => (i + variant) % 256),
      { headers },
    );
  }
  if (path.startsWith("/binary/redirect/")) {
    const variant = path.split("/").at(-1);
    return new Response(null, { status: 302, headers: { location: `/binary/data/${variant}` } });
  }
  switch (path) {
    case "/binary/font.ttf":
      return new Response(
        Bun.file(join(import.meta.dir, "../crates/engine/tests/fixtures/synthetic-font.ttf")),
        { headers },
      );
    case "/binary/bom":
      return new Response(new TextEncoder().encode("\uFEFFOlá € 😀"), { headers });
    case "/binary/invalid":
      return new Response(new Uint8Array([255, 40]), { headers });
    case "/binary/unicode-large":
      return new Response(
        new TextEncoder().encode("a".repeat(32767) + "😀" + "b".repeat(32767) + "€"),
        { headers },
      );
    case "/binary/json":
      return new Response(new TextEncoder().encode('\uFEFF{"value":"Olá € 😀"}'), { headers });
    case "/binary/json-bad":
      return new Response(new Uint8Array([255]), { headers });
    case "/binary/empty":
      return new Response(new Uint8Array(0), { headers });
    case "/binary/no-content":
      return new Response(null, { status: 204, headers });
    case "/binary/large":
      return new Response(new Uint8Array(2 * 1024 * 1024).fill(255), { headers });
    default:
      return new Response(new Uint8Array([255, 0]), { status: 404, headers });
  }
}
