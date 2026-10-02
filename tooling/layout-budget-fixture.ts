export function layoutBudgetFixture(path: string): Response | undefined {
  if (!path.startsWith("/layout-budget/")) return undefined;
  const variant = Number(path.split("/").at(-1)) || 0;
  const nodes = path.includes("/depth/")
    ? "<div>".repeat(150) + "</div>".repeat(150)
    : "<div></div>".repeat(path.includes("/generated/") ? 300 : 1100);
  const sheet = path.includes("/generated/")
    ? '<style>div::before,div::after{content:"";display:block;height:1px}</style>'
    : "";
  return new Response(
    `<!doctype html>${sheet}<main id="root" style="width:${8 + variant}px;height:3px">${nodes}</main><script>function layoutBudgetCase(v){const root=document.querySelector('#root'),r=root.getBoundingClientRect();return {width:r.width===8+v,height:r.height===3,edges:r.right-r.left===r.width&&r.bottom-r.top===r.height,origin:Number.isFinite(r.x)&&Number.isFinite(r.y),owner:root.children.length===1100,first:root.firstElementChild.tagName==='DIV',last:root.lastElementChild.tagName==='DIV',nodes:document.querySelectorAll('*').length===1105}}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
