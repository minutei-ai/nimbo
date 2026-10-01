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
          const children = section.firstElementChild === first && section.lastElementChild.textContent === 'second';
          const siblings = first.nextElementSibling.previousElementSibling === first && first.previousElementSibling === null;
          const connected = first.isConnected && document.isConnected && document.contains(first) && first.contains(first);
          const rootParent = document.documentElement.parentElement;
          first.removeAttribute('data-state');
          const removed = !first.hasAttribute('data-state');
          first.setAttribute('data-state', '${variant}');
          const changed = first.matches('[data-state="${variant}"]');
          first.remove();
          const detached = first.parentElement === null && !first.isConnected && !document.contains(first) && first.nextElementSibling === null;
          const after = section.querySelector('.item:first-child').textContent;
          section.appendChild(first);
          const restored = first.parentElement === section && first.isConnected && section.lastElementChild === first && first.previousElementSibling.textContent === 'second';
          const text = section.querySelector('.item:last-child').textContent;
          const leading = section.firstChild;
          const comment = leading.nextSibling;
          const parsedNodes = leading instanceof Text && leading.nodeType === 3 && leading.nodeName === '#text'
            && comment instanceof Comment && comment.nodeType === 8 && comment.data === 'before'
            && comment.previousSibling === leading && leading.parentNode === section;
          const hierarchy = document instanceof Document && document instanceof Node && !(document instanceof Element)
            && first instanceof Element && first instanceof Node && leading instanceof CharacterData;
          const documentNode = document.nodeType === 9 && document.nodeName === '#document'
            && document.textContent === null && document.nodeValue === null && document.parentNode === null;
          const created = document.createTextNode('created-${variant}-😀');
          const note = document.createComment('note-${variant}');
          const constructed = new Text('constructor') instanceof Text && new Comment('constructor') instanceof Comment;
          const fresh = created.parentNode === null && !created.isConnected && created.nodeValue === 'created-${variant}-😀'
            && created.length === 'created-${variant}-😀'.length && created.textContent === created.data;
          const appended = section.appendChild(created) === created && section.appendChild(note) === note
            && section.lastChild === note && note.previousSibling === created && created.nextSibling === note
            && created.parentElement === section && created.isConnected && document.contains(created);
          created.data = 'changed-${variant}-α';
          note.textContent = 'changed note';
          const mutated = created.nodeValue === 'changed-${variant}-α' && section.textContent.endsWith(created.data)
            && note.data === 'changed note' && !section.textContent.includes(note.data)
            && section.innerHTML.endsWith('changed-${variant}-α<!--changed note-->');
          first.nodeValue = 'ignored';
          const elementValue = first.nodeValue === null && first.textContent === before;
          created.remove();
          const textDetached = !created.isConnected && created.parentNode === null && created.nextSibling === null
            && note.previousSibling === first;
          let cycle = false;
          try { first.appendChild(section); } catch { cycle = true; }
          const cycleSafe = cycle && first.parentNode === section && section.parentNode === document.getElementById('root');
          const nodeChecks = {parsedNodes, hierarchy, documentNode, constructed, fresh, appended, mutated, elementValue, textDetached, cycleSafe};
          const result = await fetch('/echo', {method: 'POST', body: 'payload-${variant}-α'});
          return {title: document.title, before, self, ancestor, matches, missing,
            parent, children, siblings, connected, rootParent, removed, changed, detached, after, restored, text,
            nodeChecks, count: document.querySelectorAll('main .item').length, echo: await result.json()};
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
      `<title>Document ${variant}</title><main id="root"><section class="group" data-id="${variant}"> leading <!--before--><i class="item" data-state="old">α &amp; ${variant}</i> <!--between--><i class="item">second</i> <!--after--></section><i class="item">outside</i></main><script src="/script/${variant}"></script><script>${expressionFor(variant)}.then(value => globalThis.comparison = value);</script>`,
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
      children: true,
      siblings: true,
      connected: true,
      rootParent: null,
      removed: true,
      changed: true,
      detached: true,
      after: "second",
      restored: true,
      text: `α & ${variant}`,
      nodeChecks: {
        parsedNodes: true,
        hierarchy: true,
        documentNode: true,
        constructed: true,
        fresh: true,
        appended: true,
        mutated: true,
        elementValue: true,
        textDetached: true,
        cycleSafe: true,
      },
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
      // Pinned v0.2.3 has two observed DOM defects; Nimbo must still pass
      // the standards-based expectations above, rather than inherit them.
      expect(baseline).toEqual({
        ...expected,
        nodeChecks: { ...expected.nodeChecks, documentNode: false, mutated: false },
      });
    }
    expect(requests).toContain(`GET /${variant}`);
    expect(requests).toContain("POST /echo");
    expect(requests).toContain(`GET /script/${variant}`);
  },
);
