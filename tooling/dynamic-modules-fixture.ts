export function dynamicModulesFixture(path: string): Response | undefined {
  if (path === "/dynamic-modules/errors") {
    return new Response(
      `<!doctype html><script>globalThis.comparison=(async()=>{const capture=name=>import(name).then(()=>null,error=>error);const missing=await capture('./errors/missing.js');const missingAgain=await capture('./errors/missing.js');const mime=await capture('./errors/mime.js');const syntax=await capture('./errors/syntax.js');const thrown=await capture('./errors/throw.js');const thrownAgain=await capture('./errors/throw.js');const pageOom=await capture('./errors/page-oom.js');const firstGraph=await capture('./errors/first.js');const secondGraph=await capture('./errors/second.js');const attributes=await import('./errors/never.js',{with:{type:'json'}}).then(()=>null,error=>error);return {missing:missing instanceof TypeError,missingRetry:missingAgain instanceof TypeError,mime:mime instanceof TypeError,syntax:syntax instanceof SyntaxError,thrown:thrown instanceof EvalError,throwCache:thrown===thrownAgain,once:globalThis.throwLoads===1,pageOom:pageOom instanceof Error&&pageOom.message==='out of memory',firstGraph:firstGraph instanceof TypeError,secondGraph:secondGraph instanceof TypeError,attributes:attributes instanceof TypeError,notExecuted:typeof globalThis.mimeExecuted==='undefined'};})();</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path.startsWith("/dynamic-modules/errors/")) {
    if (path.endsWith("/mime.js")) {
      return new Response("globalThis.mimeExecuted=true;", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (path.endsWith("/syntax.js")) {
      return new Response("export const value=;", {
        headers: { "content-type": "text/javascript" },
      });
    }
    if (path.endsWith("/page-oom.js")) {
      return new Response("throw new Error('out of memory');", {
        headers: { "content-type": "text/javascript" },
      });
    }
    if (path.endsWith("/throw.js")) {
      return new Response(
        "globalThis.throwLoads=(globalThis.throwLoads??0)+1;throw new EvalError('module failure');",
        { headers: { "content-type": "text/javascript" } },
      );
    }
    if (path.endsWith("/first.js") || path.endsWith("/second.js")) {
      return new Response("import './shared-missing.js';", {
        headers: { "content-type": "text/javascript" },
      });
    }
    return new Response("Not found", { status: 404 });
  }
  const match = /^\/dynamic-modules\/(\d+)(\/.*)?$/u.exec(path);
  if (match === null) return undefined;
  const variant = Number(match[1]);
  const file = match[2] ?? "/";
  if (file === "/graph/root.js") {
    return new Response(
      `import { value, bump } from './dependency.js';globalThis.moduleLoads=(globalThis.moduleLoads??0)+1;await Promise.resolve();export { value, bump };export const url=import.meta.url;`,
      { headers: { "content-type": "text/javascript" } },
    );
  }
  if (file === "/graph/dependency.js") {
    return new Response(
      `globalThis.dependencyLoads=(globalThis.dependencyLoads??0)+1;export let value=${42 + variant};export function bump(){value++;}`,
      { headers: { "content-type": "text/javascript" } },
    );
  }
  if (file !== "/") return new Response("Not found", { status: 404 });
  return new Response(
    `<!doctype html><body data-module="/dynamic-modules/${variant}/graph/root.js"><script>globalThis.rootLoads=(globalThis.rootLoads??0)+1;globalThis.comparison=(async()=>{const name=document.body.dataset.module;const [first,second]=await Promise.all([import(name),import(name)]);const cached=await import(name);const before=first.value;first.bump();return {identity:first===second&&second===cached,initial:before===${42 + variant},live:first.value===${43 + variant}&&second.value===first.value,root:rootLoads===1,module:moduleLoads===1,dependency:dependencyLoads===1,meta:first.url===new URL(name,location.href).href,privateLoader:typeof globalThis.__quickjsSetModulePreload==='undefined'};})();</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
