export const hotPathScenarios = [
  {
    name: "live-child-iteration",
    expression:
      "(()=>{let seen=0;for(const child of document.body.children)seen+=child.nodeType===1;return seen===1000})()",
    rows: 1000,
  },
  {
    name: "named-access-after-style",
    expression:
      "(()=>{const e=document.getElementById('item0');let count=0;for(let i=0;i<48;i++){e.style.opacity=String(i/48);if(typeof missingWindowProperty==='undefined')count++;}return count===48})()",
    rows: 512,
  },
  {
    name: "same-class-with-layout",
    expression:
      "(()=>{const e=document.getElementById('item0');let count=0;for(let i=0;i<12;i++){e.className='entry';if(e.getBoundingClientRect().height===10)count++;}return count===12})()",
    rows: 48,
  },
  {
    name: "selector-heavy-layout",
    expression:
      "(()=>{const nodes=document.querySelectorAll('.entry');return nodes.length===192&&Array.from(nodes).every(e=>e.getBoundingClientRect().width===20)})()",
    rows: 192,
  },
  {
    name: "inline-text-layout",
    expression:
      "(()=>{const e=document.getElementById('item0');e.style.cssText='font:16px/20px serif;height:auto';e.innerHTML='alpha <span>beta gamma</span> delta alpha <span>beta gamma</span> delta';let count=0;for(let i=0;i<12;i++){const width=110+i*2;e.style.width=width+'px';const rect=e.getBoundingClientRect();if(rect.width===width&&rect.height>=20)count++;}return count===12})()",
    rows: 48,
  },
  {
    name: "atomic-inline-layout",
    expression:
      "(()=>{const e=document.getElementById('item0');e.style.cssText='font:16px/24px serif;height:auto';e.innerHTML='<span style=\"display:inline-flex;width:60px;height:32px;align-items:center\">AB</span><span style=\"display:inline-flex;width:60px;height:20px;align-items:center\">CD</span>';let count=0;for(let i=0;i<12;i++){const width=110+i*2;e.style.width=width+'px';const rect=e.getBoundingClientRect();if(rect.width===width&&rect.height>=32)count++;}return count===12})()",
    rows: 48,
  },
] as const;

export function hotPathFixture(path: string): Response | undefined {
  const scenario = hotPathScenarios.find((item) => path === `/${item.name}`);
  if (!scenario) return undefined;
  const rules = Array.from({ length: 80 }, (_, i) => `.unused${i}>[data-kind]{width:1px}`).join("");
  return new Response(
    `<!doctype html><style>html,body{margin:0}.entry{display:block;width:20px;height:10px}${rules}</style><body>${Array.from({ length: scenario.rows }, (_, i) => `<div id="item${i}" class="entry a b c d e f" data-kind="example"></div>`).join("")}`,
    { headers: { "content-type": "text/html", "cache-control": "no-store" } },
  );
}
