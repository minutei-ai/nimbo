import { createHash } from "node:crypto";
import { join } from "node:path";
import sources from "./wpt-url-sources.json";

export async function createWptUrlFixture(root: string, port = 0) {
  const files = new Map<string, Uint8Array>();
  for (const { path, sha256 } of sources.files) {
    // Verify every original harness, test and data file before starting the engine.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const bytes = new Uint8Array(await Bun.file(join(root, path)).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== sha256)
      throw new Error(`Original WPT source mismatch: ${path}`);
    files.set(`/${path}`, bytes);
  }
  const decoder = new TextDecoder();
  const cases = [...files.keys()]
    .filter((path) => path.endsWith(".any.js"))
    .flatMap((path) => {
      const script = decoder.decode(files.get(path));
      const variants = [...script.matchAll(/^\/\/ META: variant=(.*)$/gm)].map(
        (match) => match[1] ?? "",
      );
      return (variants.length ? variants : [""]).map((variant) => ({ path, variant, script }));
    });
  const wrapperSource = decoder.decode(files.get("/tools/serve/serve.py"));
  const originalGlobals = /class AnyHtmlHandler[^]*?<script>([^]*?)<\/script>/.exec(
    wrapperSource,
  )?.[1];
  if (!originalGlobals) throw new Error("Missing original WPT window metadata");
  const reporter = `setup({output:false,message_events:[]});
  globalThis.wptResult=null;
  add_completion_callback((tests,status)=>{
    globalThis.wptResult={status:status.status,message:status.message,total:tests.length,
      passed:tests.filter(test=>test.status===0).length,
      failed:tests.filter(test=>test.status!==0).map(test=>({name:test.name,status:test.status,message:test.message}))};
  });`;
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith(".any.html")) {
        const path = url.pathname.replace(/\.any\.html$/, ".any.js");
        const original = files.get(path);
        if (!original) return new Response("Not found", { status: 404 });
        const script = decoder.decode(original);
        const dependencies = [...script.matchAll(/^\/\/ META: script=(.*)$/gm)]
          .map((match) => `<script src="${match[1]}"></script>`)
          .join("");
        const timeout = /^\/\/ META: timeout=long$/m.test(script)
          ? '<meta name="timeout" content="long">'
          : "";
        return new Response(
          `<!doctype html><meta charset="utf-8">${timeout}<script>${originalGlobals}</script><script src="/resources/testharness.js"></script><script>${reporter}</script>${dependencies}<script src="${path}"></script>`,
          { headers: { "content-type": "text/html", "cache-control": "no-store" } },
        );
      }
      // Preserve the original WPT server's WebIDLParser rewrite.
      const path =
        url.pathname === "/resources/WebIDLParser.js"
          ? "/resources/webidl2/lib/webidl2.js"
          : url.pathname;
      const original = files.get(path);
      if (!original) return new Response("Not found", { status: 404 });
      return new Response(original, {
        headers: {
          "content-type": path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".json")
              ? "application/json"
              : "text/plain",
          "cache-control": "no-store",
        },
      });
    },
  });
  return { fixture, cases };
}
