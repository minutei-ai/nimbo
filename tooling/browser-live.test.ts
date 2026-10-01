import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";

const requests: string[] = [];
const comparisonBinary = process.env.NIMBO_COMPARE_OBSCURA_BINARY;
const expressionFor = (variant: number) => `(async () => {
          const section = document.querySelector('[data-id="${variant}"]');
          const first = section.querySelector('.item:first-child');
          const before = first.textContent;
          const self = first.closest('i') === first;
          const ancestor = first.closest('main') === document.getElementById('root');
          const matches = first.matches('section > i.item[data-state="old"]');
          const missing = first.closest('.missing');
          const parent = first.parentElement === section;
          const rootParent = document.documentElement.parentElement;
          first.removeAttribute('data-state');
          const removed = !first.hasAttribute('data-state');
          first.setAttribute('data-state', '${variant}');
          const changed = first.matches('[data-state="${variant}"]');
          first.remove();
          const detached = first.parentElement === null;
          const after = section.querySelector('.item:first-child').textContent;
          section.appendChild(first);
          const restored = first.parentElement === section;
          const text = section.querySelector('.item:last-child').textContent;
          const result = await fetch('/echo', {method: 'POST', body: 'payload-${variant}-α'});
          return {title: document.title, before, self, ancestor, matches, missing,
            parent, rootParent, removed, changed, detached, after, restored, text,
            count: document.querySelectorAll('main .item').length, echo: await result.json()};
        })()`;

const origin = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (path === "/echo")
      return Response.json({ method: request.method, body: await request.text() });
    if (path.startsWith("/script/"))
      return new Response("document.title += ' loaded';", {
        headers: { "content-type": "text/javascript" },
      });
    const variant = Number(path.slice(1));
    if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
      return new Response("Not found", { status: 404 });
    return new Response(
      `<title>Document ${variant}</title><main id="root"><section class="group" data-id="${variant}"><i class="item" data-state="old">α &amp; ${variant}</i><i class="item">second</i></section><i class="item">outside</i></main><script src="/script/${variant}"></script><script>${expressionFor(variant)}.then(value => globalThis.comparison = value);</script>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
});

const worker = new Miniflare({
  modules: [
    { type: "ESModule", path: join(import.meta.dir, "../dist/worker/index.js") },
    { type: "CompiledWasm", path: join(import.meta.dir, "../dist/worker/nimbo_engine_bg.wasm") },
  ],
  compatibilityDate: "2026-07-30",
  bindings: { API_TOKEN: "test-secret" },
});

beforeAll(async () => {
  await worker.ready;
});

afterAll(async () => {
  await worker.dispose();
  await origin.stop(true);
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: selectors, ancestry, mutations and POST variant %i",
  async (variant) => {
    const url = new URL(String(variant), origin.url).href;

    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    const expected = {
      title: `Document ${variant} loaded`,
      before: `α & ${variant}`,
      self: true,
      ancestor: true,
      matches: true,
      missing: null,
      parent: true,
      rootParent: null,
      removed: true,
      changed: true,
      detached: true,
      after: "second",
      restored: true,
      text: `α & ${variant}`,
      count: 3,
      echo: { method: "POST", body: `payload-${variant}-α` },
    };
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
    if (comparisonBinary) {
      const child = Bun.spawn(
        [
          comparisonBinary,
          "fetch",
          url,
          "--allow-private-network",
          "--wait-until",
          "networkidle0",
          "--wait",
          "0",
          "--quiet",
          "--eval",
          "JSON.stringify(globalThis.comparison)",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [output, error, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(error).toBe("");
      expect(exit).toBe(0);
      const baseline: unknown = JSON.parse(output);
      expect(baseline).toEqual(expected);
    }
    expect(requests).toContain(`GET /${variant}`);
    expect(requests).toContain("POST /echo");
    expect(requests).toContain(`GET /script/${variant}`);
  },
);
