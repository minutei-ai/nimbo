const htmlResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html", "cache-control": "no-store" } });

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
  {
    name: "dynamic-fetch",
    path: "/dynamic",
    expression: "Promise.resolve(globalThis.__benchmarkReady).then(() => document.title)",
    expected: "Loaded",
  },
  {
    name: "js-dom-events",
    path: "/app/classic",
    expression:
      "Promise.resolve(globalThis.__benchmarkReady).then(()=>{document.getElementById('action').dispatchEvent(new Event('click'));return document.getElementById('app').textContent})",
    expected: Array.from({ length: 12 }, (_, i) => `Item ${i}`).join("") + "Clicked",
  },
  {
    name: "js-modules",
    path: "/app/modules",
    expression:
      "Promise.resolve(globalThis.__benchmarkReady).then(()=>document.querySelectorAll('#app .entry').length)",
    expected: 12,
  },
  {
    name: "js-dom-selectors-200",
    path: "/app/classic",
    expression:
      "Promise.resolve(globalThis.__benchmarkReady).then(()=>{let value;for(let i=0;i<200;i++)value=document.querySelector('#app .entry').textContent;return value})",
    expected: "Item 0",
  },
] as const;
export const comparisonScenarios = [
  ...benchmarkScenarios,
  {
    name: "static-5000",
    path: "/static?rows=5000",
    expression: benchmarkScenarios[0].expression,
    expected: "row",
  },
  {
    name: "selectors-200-5000",
    path: "/static?rows=5000",
    expression: benchmarkScenarios[1].expression,
    expected: "row",
  },
] as const;
export function benchmarkFixture(request: Request): Response {
  const url = new URL(request.url);
  const rows = url.searchParams.get("rows") === "5000" ? 5000 : 16;
  const html = `<title>Static</title><main><ul>${"<li class=entry>row</li>".repeat(rows)}</ul></main>`;
  const appScript = `async function render(data) {await new Promise(resolve=>setTimeout(resolve,5));const app=document.getElementById('app');for(const value of data){const card=document.createElement('div');card.className='entry';card.textContent='Item '+value;app.appendChild(card);}const button=document.createElement('button');button.id='action';button.addEventListener('click',()=>button.textContent='Clicked');app.appendChild(button);return true;}`;
  switch (url.pathname) {
    case "/app/api":
      return request.method === "POST"
        ? Response.json(
            Array.from({ length: 12 }, (_, i) => i),
            { headers: { "cache-control": "no-store" } },
          )
        : new Response("POST required", { status: 405 });
    case "/app/data.js":
      return new Response(
        "export async function load(){return fetch('/app/api',{method:'POST',body:'load'}).then(r=>r.json())}",
        { headers: { "content-type": "application/javascript", "cache-control": "no-store" } },
      );
    case "/app/classic":
      return htmlResponse(
        `<main id=app></main><script>${appScript}globalThis.__benchmarkReady=fetch('/app/api',{method:'POST',body:'load'}).then(r=>r.json()).then(render);</script>`,
      );
    case "/app/modules":
      return htmlResponse(
        `<main id=app></main><script type=module>import {load} from '/app/data.js';${appScript}globalThis.__benchmarkReady=load().then(render);</script>`,
      );

    case "/api":
      return Response.json({ title: "Loaded" }, { headers: { "cache-control": "no-store" } });
    case "/dynamic":
      return new Response(
        `${html}<script>globalThis.__benchmarkReady=fetch('/api').then(r => r.json()).then(data => document.title = data.title);</script>`,
        { headers: { "content-type": "text/html", "cache-control": "no-store" } },
      );
    default:
      return new Response(html, {
        headers: { "content-type": "text/html", "cache-control": "no-store" },
      });
  }
}
