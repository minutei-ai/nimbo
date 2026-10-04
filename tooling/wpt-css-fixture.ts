import { createHash } from "node:crypto";
import { join } from "node:path";

export async function createWptCssFixture(
  root: string,
  sources: { files: { path: string; sha256: string }[] },
) {
  const files = new Map<string, Uint8Array>();
  for (const { path, sha256 } of sources.files) {
    // Verify original fixtures, helper and harness before either runtime starts.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const bytes = new Uint8Array(await Bun.file(join(root, path)).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== sha256)
      throw new Error(`Original WPT source mismatch: ${path}`);
    files.set(`/${path}`, bytes);
  }
  // WPT reserves testharnessreport.js for vendor reporting integration. Preserve
  // its original bytes and append reporting only; every assertion stays original.
  const reporter = `\nsetup({output:false,message_events:[]});globalThis.wptResult=null;
  add_completion_callback((tests,status)=>{globalThis.wptResult={status:status.status,
    message:status.message,total:tests.length,passed:tests.filter(test=>test.status===0).length,
    failed:tests.filter(test=>test.status!==0).map(test=>({name:test.name,status:test.status,message:test.message}))};});`;
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const original = files.get(path);
      if (!original) return new Response("Not found", { status: 404 });
      const body =
        path === "/resources/testharnessreport.js"
          ? new TextDecoder().decode(original) + reporter
          : original;
      return new Response(body, {
        headers: {
          "content-type": path.endsWith(".html") ? "text/html" : "text/javascript",
          "cache-control": "no-store",
        },
      });
    },
  });
}
