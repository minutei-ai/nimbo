export function importMapFixture(path: string): Response | undefined {
  if (!path.startsWith("/import-maps/")) return undefined;
  const javascript: Record<string, string> = {
    "root.js":
      "import {value} from 'value';import {readA} from 'pkg/a.js';import collision from './alias.js';globalThis.comparison={ordered:collision===73,scoped:value===73,cycle:readA()===10,dynamic:import('pkg/a.js').then(ns=>ns.readA()===10),blocked:import('blocked').then(()=>false,()=>true),escape:import('pkg/../escape.js').then(()=>false,()=>true)};globalThis.comparison=Promise.all(Object.entries(comparison).map(async([key,value])=>[key,await value])).then(Object.fromEntries);",
    "value.js": "export const value=73;export default 73;",
    "a.js":
      "import {readB} from './b.js';export const a=3;export function readA(){return a+readB();}",
    "b.js": "import {a} from './a.js';export function readB(){return a+4;}",
  };
  const name = path.split("/").at(-1) ?? "";
  const source = javascript[name];
  if (source !== undefined)
    return new Response(source, { headers: { "content-type": "text/javascript" } });
  const variant = Number(name);
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><script type="importmap">{"imports":{"value":"/missing.js","pkg/":"/import-maps/${variant}/","blocked":null,"./${variant}/z/../alias.js":"/missing.js","./${variant}/alias.js":"/import-maps/${variant}/value.js"},"scopes":{"/import-maps/${variant}/":{"value":"/import-maps/${variant}/value.js"}}}</script><script type="module" src="/import-maps/${variant}/root.js"></script>`,
    { headers: { "content-type": "text/html" } },
  );
}
