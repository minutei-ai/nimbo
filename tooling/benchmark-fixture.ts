const html = `<title>Static</title><main><ul>${"<li class=entry>row</li>".repeat(16)}</ul></main>`;
export const benchmarkScenarios = [
  {
    name: "static",
    path: "/static",
    expression: "document.querySelector('.entry').textContent",
    expected: "row",
  },
  {
    name: "selectors-200",
    path: "/static",
    expression:
      "(() => { let value; for (let i = 0; i < 200; i++) value = document.querySelector('.entry').textContent; return value; })()",
    expected: "row",
  },
  { name: "dynamic-fetch", path: "/dynamic", expression: "document.title", expected: "Loaded" },
] as const;
export function benchmarkFixture(request: Request): Response {
  switch (new URL(request.url).pathname) {
    case "/api":
      return Response.json({ title: "Loaded" });
    case "/dynamic":
      return new Response(
        `${html}<script>fetch('/api').then(r => r.json()).then(data => document.title = data.title);</script>`,
        { headers: { "content-type": "text/html" } },
      );
    default:
      return new Response(html, { headers: { "content-type": "text/html" } });
  }
}
