import { join } from "node:path";

const script = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/external-styles.txt"),
).text();

export function externalStylePage(variant: number): Response {
  return new Response(
    `<!doctype html><html><head><link id="initial" rel="stylesheet" href="/sheets-css/main?v=${variant}"></head><body><script>globalThis.variant=${variant};${script}</script></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}

export function externalStyleResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/sheets-css/")) return null;
  const variant = Number(url.searchParams.get("v"));
  const name = url.pathname.split("/").at(-1);
  if (name === "redirect")
    return new Response(null, {
      status: 302,
      headers: { location: `/sheets-css/final?v=${variant}` },
    });
  if (name === "missing")
    return new Response("missing", { status: 404, headers: { "content-type": "text/css" } });
  if (name === "oversized" || name === "total-a" || name === "total-b" || name === "large") {
    const size = name === "oversized" ? 262145 : name === "large" ? 131072 : 150000;
    return new Response("/*" + "x".repeat(size) + "*/#target{width:65px;height:20px}", {
      headers: { "content-type": "text/css" },
    });
  }
  if (name === "has-import")
    return new Response("@import url('extra.css');#target{width:25px}", {
      headers: { "content-type": "text/css" },
    });
  const widths: Record<string, number> = {
    main: 40,
    later: 70,
    important: 80,
    final: 60,
    charset: 55,
  };
  const css =
    name === "variables"
      ? `body{--external:${90 + variant}px}#target{width:var(--external)}`
      : `#target{width:${(widths[name ?? ""] ?? 500) + variant}px${name === "important" ? " !important" : ""};height:30px}`;
  return new Response(css, {
    headers: {
      "content-type":
        name === "wrong-mime"
          ? "text/plain"
          : name === "charset"
            ? "TEXT/CSS; charset=utf-8"
            : "text/css",
    },
  });
}
