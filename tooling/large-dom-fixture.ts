import { join } from "node:path";
const source = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/large-dom.txt"),
).text();
export function largeDomFixture(path: string): Response | undefined {
  if (path === "/link-guard.css")
    return new Response("#target {color:rgb(7,8,9)}", { headers: { "content-type": "text/css" } });
  if (path.startsWith("/link-guard/"))
    return new Response("<div id=target></div>", { headers: { "content-type": "text/html" } });
  if (!path.startsWith("/large-dom/")) return undefined;
  const rows = "<li class=entry>row</li>".repeat(5000);
  return new Response(`<main><ul>${rows}</ul></main><script>${source}</script>`, {
    headers: { "content-type": "text/html" },
  });
}
export function largeDomExpression(variant: number): string {
  return `largeDomCase(${variant})`;
}

export function linkGuardExpression(kind: "create" | "innerHTML"): string {
  const setup =
    kind === "create"
      ? "const link=document.createElement('LINK');link.setAttribute('rel','stylesheet');link.setAttribute('href','/link-guard.css');document.head.appendChild(link);"
      : "document.head.innerHTML='<li'+'Nk rel=stylesheet href=/link-guard.css>';const link=document.head.querySelector('link');";
  return `(()=>{${setup}return new Promise(resolve=>link.addEventListener('load',()=>resolve(getComputedStyle(document.getElementById('target')).color)))})()`;
}
