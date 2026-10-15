import { expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";

const root = join(import.meta.dir, "..");
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html", ...headers } });

const origins = new WeakMap<Miniflare, string>();
const originFor = (worker: Miniflare) => {
  const origin = origins.get(worker);
  if (!origin) throw new Error("Missing HTTP fixture origin");
  return origin;
};

async function fixture(
  serve: (request: Request) => Response | Promise<Response>,
  run: (worker: Miniflare) => Promise<void>,
  egress = false,
) {
  const origin = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: serve });
  const main = {
    name: "nimbo",
    modules: [
      { type: "ESModule" as const, path: join(root, "dist/worker/index.js") },
      { type: "CompiledWasm" as const, path: join(root, "dist/worker/nimbo_engine_bg.wasm") },
    ],
    compatibilityDate: "2026-07-30",
    bindings: { API_TOKEN: "test-secret" },
    ...(egress ? { serviceBindings: { EGRESS: "egress" } } : {}),
  };
  const worker = new Miniflare({
    workers: [
      main,
      ...(egress
        ? [
            {
              name: "egress",
              modules: true,
              compatibilityDate: "2026-07-30",
              script: `export default { fetch(request) {
              const headers = new Headers(request.headers);
              headers.set('x-nimbo-test-egress', 'forwarded');
              return fetch(new Request(request, { headers }));
            } };`,
            },
          ]
        : []),
    ],
  });
  origins.set(worker, origin.url.href);
  try {
    await run(worker);
  } finally {
    origins.delete(worker);
    await worker.dispose();
    await origin.stop(true);
  }
}

const scrape = (worker: Miniflare, expression: string, url = originFor(worker)) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });

const json = async (response: Awaited<ReturnType<typeof scrape>>): Promise<unknown> =>
  response.json();

function diagnosticHeap(body: unknown): number {
  if (typeof body !== "object" || body === null) throw new Error("Missing response");
  const counters: unknown = Reflect.get(body, "diagnostics");
  if (typeof counters !== "object" || counters === null) throw new Error("Missing diagnostics");
  expect(Object.keys(counters)).toHaveLength(10);
  expect(
    Object.values(counters).every(
      (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    ),
  ).toBe(true);
  const used: unknown = Reflect.get(counters, "javascriptUsedBytes");
  if (typeof used !== "number") throw new Error("Missing heap measurement");
  return used;
}

function diagnosticCapacity(body: unknown, field = "wasmLinearBytes"): number {
  if (typeof body !== "object" || body === null) throw new Error("Missing response");
  const counters: unknown = Reflect.get(body, "diagnostics");
  if (typeof counters !== "object" || counters === null) throw new Error("Missing diagnostics");
  const bytes: unknown = Reflect.get(counters, field);
  if (typeof bytes !== "number") throw new Error("Missing Wasm capacity");
  expect(bytes).toBeGreaterThan(0);
  expect(bytes % 65536).toBe(0);
  return bytes;
}

test("Worker diagnostics separate retained Wasm capacity from a fresh page heap", async () => {
  await fixture(
    () => html("<body>capacity</body>"),
    async (worker) => {
      const run = async (expression: string) => {
        const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), expression, diagnostics: true }),
        });
        expect(response.status).toBe(200);
        return json(response);
      };
      const first = await run("true");
      const large = await run("(globalThis.kept = new ArrayBuffer(16 * 1024 * 1024), true)");
      const recovered = await run("typeof kept");
      expect(recovered).toMatchObject({ value: "undefined" });
      expect(diagnosticCapacity(large, "wasmLinearBytesBefore")).toBe(diagnosticCapacity(first));
      expect(diagnosticCapacity(large)).toBeGreaterThan(diagnosticCapacity(first));
      expect(diagnosticCapacity(recovered, "wasmLinearBytesBefore")).toBe(
        diagnosticCapacity(large),
      );
      expect(diagnosticCapacity(recovered)).toBeGreaterThanOrEqual(diagnosticCapacity(large));
      expect(diagnosticHeap(recovered)).toBeLessThan(diagnosticHeap(large));
    },
  );
});

test("optional diagnostics observe page heap growth and fresh-page isolation", async () => {
  await fixture(
    () => html("<body>diagnostics</body>"),
    async (worker) => {
      const run = async (expression: string, diagnostics?: boolean) => {
        const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), expression, diagnostics }),
        });
        expect(response.status).toBe(200);
        return json(response);
      };
      expect(await run("true")).not.toHaveProperty("diagnostics");
      expect(await run("true", false)).not.toHaveProperty("diagnostics");
      const small = diagnosticHeap(await run("true", true));
      const large = diagnosticHeap(
        await run(
          "(globalThis.kept=Array.from({length:1000},(_,i)=>({i})),document.body.setAttribute('data-marker','owned'),true)",
          true,
        ),
      );
      expect(large).toBeGreaterThan(small);
      const recovered = await run("typeof kept", true);
      expect(recovered).toMatchObject({ value: "undefined" });
      expect(diagnosticHeap(recovered)).toBeLessThan(large);
    },
  );
});

test("invalid diagnostic flags fail before origin HTTP", async () => {
  let requests = 0;
  await fixture(
    () => {
      requests++;
      return html("<body>fresh</body>");
    },
    async (worker) => {
      for (const diagnostics of [null, "true", 1, {}, []]) {
        // Validate each rejected request before checking the origin counter.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), expression: "true", diagnostics }),
        });
        expect(response.status).toBe(400);
      }
      expect(requests).toBe(0);
    },
  );
});

test("initial DOM limits reject dense input and recover with fresh page state", async () => {
  await fixture(
    (request) =>
      html(
        new URL(request.url).pathname === "/dense"
          ? "<p>".repeat(100000) + "<script>globalThis.poisoned=true</script>"
          : "<body>fresh</body>",
      ),
    async (worker) => {
      const run = (path: string, maxInitialDomNodes?: number) =>
        worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({
            url: new URL(path, originFor(worker)).href,
            expression: "typeof poisoned",
            maxInitialDomNodes,
          }),
        });
      const rejected = await run("/dense");
      expect(rejected.status).toBe(422);
      expect(await json(rejected)).toMatchObject({ error: "resource limit: initial DOM nodes" });
      const configured = await run("/", 4);
      expect(configured.status).toBe(422);
      const recovered = await run("/", 5);
      expect(recovered.status).toBe(200);
      expect(await json(recovered)).toMatchObject({ value: "undefined" });
    },
  );
});

test("invalid DOM budgets fail before origin HTTP", async () => {
  let requests = 0;
  await fixture(
    () => {
      requests++;
      return html("<body>fresh</body>");
    },
    async (worker) => {
      for (const [name, value] of ["maxInitialDomNodes", "maxDomNodes"].flatMap((budgetName) =>
        [0, -1, 65537, 1.5, "5", null].map((budgetValue) => [budgetName, budgetValue] as const),
      )) {
        // Check each rejected configuration before checking the origin counter.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), expression: "true", [name]: value }),
        });
        expect(response.status).toBe(400);
      }
      expect(requests).toBe(0);
    },
  );
});

test("native control selectors share live state with queries and CSS", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/control-selectors.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body><input id=control type=checkbox>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=controlSelectorsCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 44, failed: [] } });
      const changed = await scrape(
        worker,
        "(()=>{globalThis.current=document.getElementById('control');current.checked=true;return current.matches(':checked')})()",
      );
      expect(changed.status).toBe(200);
      expect(await json(changed)).toMatchObject({ value: true });
      const fresh = await scrape(
        worker,
        "({checked:document.getElementById('control').matches(':checked'),previous:typeof current})",
      );
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({ value: { checked: false, previous: "undefined" } });
    },
  );
});

test("native attribute presence preserves namespaces and boolean reflection", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/attribute-presence.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body><input id=control type=checkbox>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=attributePresenceCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 24, failed: [] } });
      const fresh = await scrape(worker, "document.getElementById('control').defaultChecked");
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({ value: false });
    },
  );
});

test("native selector work is bounded and failed pages release Worker capacity", async () => {
  await fixture(
    () => html(`<!doctype html><body><main>${"<div></div>".repeat(2000)}</main>`),
    async (worker) => {
      const rejected = await scrape(
        worker,
        "document.querySelectorAll('div:has(~ .absent)').length",
      );
      expect(rejected.status).toBe(422);
      const body = await json(rejected);
      if (typeof body !== "object" || body === null) throw new Error("Missing failure response");
      expect(Reflect.get(body, "error")).toContain("selector steps");
      const fresh = await scrape(worker, "document.querySelectorAll('div').length");
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({ value: 2000 });
    },
  );
});

test("native form ownership follows live trees and preserves page isolation", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/form-ownership.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body><input id=control>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=formOwnershipCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 23, failed: [] } });
      const fresh = await scrape(worker, "document.getElementById('control').form===null");
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({ value: true });
    },
  );
});

test("native form reset restores state after cancellable events", async () => {
  const source = await Bun.file(join(root, "crates/engine/tests/fixtures/form-reset.txt")).text();
  await fixture(
    () => html("<!doctype html><body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=formResetCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 26, failed: [] } });
    },
  );
});

test("native reset buttons activate form state after click delivery", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/reset-buttons.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=resetButtonsCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 42, failed: [] } });
    },
  );
});

test("native input activation preserves event state, rollback and page isolation", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/input-activation.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body><input id=control type=checkbox>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=inputActivationCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 36, failed: [] } });
      const changed = await scrape(
        worker,
        "(()=>{globalThis.current=document.getElementById('control');current.click();return current.checked})()",
      );
      expect(changed.status).toBe(200);
      expect(await json(changed)).toMatchObject({ value: true });
      const fresh = await scrape(
        worker,
        "({checked:document.getElementById('control').checked,previous:typeof current})",
      );
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({ value: { checked: false, previous: "undefined" } });
    },
  );
});

test("native UI mouse and pointer event constructors preserve owned contracts", async () => {
  const source = await Bun.file(join(root, "crates/engine/tests/fixtures/mouse-events.txt")).text();
  await fixture(
    () => html("<!doctype html><body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};return Object.values(mouseEventsCase(0)).every(Boolean)})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
    },
  );
});

test("native input checkedness owns dirty state and fresh-page isolation", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/input-checkedness.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body><input id=control type=checkbox checked>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};return Object.values(inputCheckednessCase(0)).every(Boolean)})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
      const changed = await scrape(
        worker,
        "(()=>{globalThis.current=document.getElementById('control');current.checked=false;current.indeterminate=true;current.defaultChecked=false;current.defaultChecked=true;return !current.checked&&current.indeterminate&&current.defaultChecked})()",
      );
      expect(changed.status).toBe(200);
      expect(await json(changed)).toMatchObject({ value: true });
      const fresh = await scrape(
        worker,
        "({checked:document.getElementById('control').checked,indeterminate:document.getElementById('control').indeterminate,previous:typeof current})",
      );
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({
        value: { checked: true, indeterminate: false, previous: "undefined" },
      });
    },
  );
});

test("native input value modes transfer state and preserve failed reflected writes", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/input-value-modes.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body><input id=control type=hidden value=fresh>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};return Object.values(inputValueModesCase(0)).every(Boolean)})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
      const failed = await scrape(
        worker,
        "(()=>{globalThis.current=document.getElementById('control');current.value='before';let failed=false;try{current.value='x'.repeat(4194304)}catch(e){failed=e.message.includes('resource limit: DOM write bytes')}return failed&&current.value==='before'&&current.defaultValue==='before'})()",
      );
      expect(failed.status).toBe(200);
      expect(await json(failed)).toMatchObject({ value: true });
      const fresh = await scrape(
        worker,
        "({value:document.getElementById('control').value,previous:typeof current})",
      );
      expect(fresh.status).toBe(200);
      expect(await json(fresh)).toMatchObject({ value: { value: "fresh", previous: "undefined" } });
    },
  );
});

test("native text controls preserve dirty values, mutations and page isolation", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/text-controls.txt"),
  ).text();
  await fixture(
    () =>
      html(
        "<!doctype html><body><input id=initial value=fresh><textarea id=area>initial</textarea>",
      ),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};globalThis.kept=document.getElementById('initial');kept.value='dirty';return Object.values(textControlsCase(0)).every(Boolean)})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
      const recovered = await scrape(
        worker,
        "({input:document.getElementById('initial').value,area:document.getElementById('area').value,previous:typeof kept})",
      );
      expect(recovered.status).toBe(200);
      expect(await json(recovered)).toMatchObject({
        value: { input: "fresh", area: "initial", previous: "undefined" },
      });
      const failed = await scrape(
        worker,
        "(()=>{const input=document.getElementById('initial');input.value='before';let failed=false;try{input.value='x'.repeat(4194304)}catch(e){failed=e.message.includes('resource limit: DOM write bytes')}return failed&&input.value==='before'&&input.defaultValue==='fresh'})()",
      );
      expect(failed.status).toBe(200);
      expect(await json(failed)).toMatchObject({ value: true });
    },
  );
});

test("cooperative parsing preserves Unicode across host blocks", async () => {
  const prefix = "<!doctype html><body><p id=value>";
  const repeated = 8191 - prefix.length;
  await fixture(
    () => html(`${prefix}${"x".repeat(repeated)}😀${"Ā".repeat(9000)}&amp;tail</p>`),
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          expression: `document.getElementById('value').textContent==='x'.repeat(${repeated})+'😀'+'Ā'.repeat(9000)+'&tail'`,
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
    },
  );
});

test("cooperative document parsing enforces deadline and releases capacity", async () => {
  await fixture(
    (request) =>
      html(
        new URL(request.url).pathname === "/deep"
          ? `<!doctype html><body>${"<div>".repeat(60000)}x${"</div>".repeat(60000)}<script>globalThis.poisoned=true</script>`
          : "<!doctype html><body>fresh</body>",
      ),
    async (worker) => {
      const run = (path: string) =>
        worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({
            url: new URL(path, originFor(worker)).href,
            expression: "typeof poisoned",
          }),
        });
      const started = performance.now();
      const rejected = await run("/deep");
      expect(rejected.status).toBe(504);
      expect(performance.now() - started).toBeLessThan(14000);
      const recovered = await run("/");
      expect(recovered.status).toBe(200);
      expect(await json(recovered)).toMatchObject({ value: "undefined" });
    },
  );
}, 15000);

test("large attribute counts remain live under default Worker budgets", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/attribute-count.txt"),
  ).text();
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          expression: `(()=>{${source};const map=attributeCountSetup(16000).attributes;for(let i=0;i<512;i++)if(map.length!==16000)return false;return Object.values(attributeCountCase(0)).every(Boolean)})()`,
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
    },
  );
});

test("native fragment parsing preserves browser recovery and detached references", async () => {
  const source = await Bun.file(join(root, "crates/engine/tests/fixtures/dom-arena.txt")).text();
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          expression: `(()=>{${source};return Object.values(fragmentCase()).every(Boolean)})()`,
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
    },
  );
});

test("cumulative DOM quotas bound native factories and preserve failed writes", async () => {
  const source = await Bun.file(join(root, "crates/engine/tests/fixtures/dom-arena.txt")).text();
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const run = async (expression: string) => {
        const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), expression, maxDomNodes: 32 }),
        });
        expect(response.status).toBe(200);
        expect(await json(response)).toMatchObject({ value: true });
      };
      for (const mode of [
        "element",
        "namespace",
        "text",
        "comment",
        "fragment",
        "document",
        "htmlDocument",
        "shadow",
        "textContent",
      ]) {
        // Each factory starts in a fresh page with the same quota.
        // oxlint-disable-next-line eslint/no-await-in-loop
        await run(`(()=>{${source};return arenaFactoryCase('${mode}')})()`);
      }
      await run(
        "(()=>{document.body.innerHTML='<b id=kept>old</b>';const old=document.getElementById('kept');let failed=false;try{document.body.innerHTML='<p>'.repeat(1000)}catch(e){failed=e.message.includes('resource limit: DOM nodes')}const preserved=failed&&document.getElementById('kept')===old&&old.textContent==='old';document.body.innerHTML='';return preserved&&document.body.childNodes.length===0})()",
      );
      await run("document.createElement('i').tagName==='I'");
    },
  );
});

test("workerd loads Rust Wasm and executes inline JS, lifecycle and DOM selectors", async () => {
  await fixture(
    () =>
      html(`<title>Nimbo</title><h1>before</h1><script>
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('h1').textContent = 'Rust Wasm';
      });
    </script>`),
    async (worker) => {
      expect(await json(await worker.dispatchFetch("https://nimbo.test/health"))).toMatchObject({
        engine: "rust-wasm-quickjs",
        version: "0.1.0",
        limits: {
          max_dom_operations: 10000,
          max_dom_nodes: 65536,
          timeout: { secs: 10, nanos: 0 },
        },
      });
      const response = await scrape(worker, "document.querySelector('h1').textContent");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: "Rust Wasm" });
    },
  );
});

test("external scripts and Promise fetch use Worker transport with cookies and POST", async () => {
  const requests: { path: string; cookie: string | null; method: string; body: string }[] = [];
  await fixture(
    async (request) => {
      const path = new URL(request.url).pathname;
      requests.push({
        path,
        cookie: request.headers.get("cookie"),
        method: request.method,
        body: await request.text(),
      });
      if (path === "/")
        return new Response(null, {
          status: 302,
          headers: { location: "/page", "set-cookie": "session=one; HttpOnly; Path=/" },
        });
      if (path === "/page") return html('<h1></h1><script src="/app.js"></script>');
      if (path === "/app.js")
        return new Response(
          "globalThis.loaded = fetch('/api', {method: 'POST', body: 'payload'}).then(r => r.json()).then(v => { document.querySelector('h1').textContent = v.name; });",
        );
      return Response.json({ name: "async Rust" });
    },
    async (worker) => {
      const response = await scrape(
        worker,
        "loaded.then(() => document.querySelector('h1').textContent)",
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        url: new URL("/page", originFor(worker)).href,
        value: "async Rust",
      });
      expect(requests.map((request) => request.path)).toEqual(["/", "/page", "/app.js", "/api"]);
      expect(requests.slice(1).every((request) => request.cookie === "session=one")).toBe(true);
      expect(requests.at(-1)).toMatchObject({ method: "POST", body: "payload" });
    },
  );
});

test("guest JS cannot access Worker credentials or host bindings", async () => {
  await fixture(
    () => html("<h1>isolated</h1>"),
    async (worker) => {
      expect(
        await json(
          await scrape(
            worker,
            "[typeof process, typeof Bun, typeof WebAssembly, typeof API_TOKEN, typeof EGRESS]",
          ),
        ),
      ).toMatchObject({ value: ["undefined", "undefined", "undefined", "undefined", "undefined"] });
    },
  );
});

test.each([
  ["classic HTTP failure", "", "/missing.js"],
  ["async HTTP failure", "async", "/missing.js"],
  ["classic origin denial", "", "https://blocked.test/blocked.js"],
  ["async origin denial", "async", "https://blocked.test/blocked.js"],
  ["classic invalid URL", "", "javascript:globalThis.ran=false"],
  ["async invalid URL", "async", "javascript:globalThis.ran=false"],
  ["classic redirect denial", "", "/redirect.js"],
  ["async redirect denial", "async", "/redirect.js"],
  ["classic redirect scheme denial", "", "/redirect-scheme.js"],
  ["async redirect scheme denial", "async", "/redirect-scheme.js"],
] as const)("script resource events: %s", async (_name, attributes, source) => {
  const requests: string[] = [];
  await fixture(
    (request) => {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/missing.js") return new Response("missing", { status: 404 });
      if (path === "/redirect.js")
        return new Response(null, {
          status: 302,
          headers: { location: "https://blocked.test/redirected.js" },
        });
      if (path === "/redirect-scheme.js")
        return new Response(null, {
          status: 302,
          headers: { location: "javascript:globalThis.ran=false" },
        });
      return html(`<script>
        globalThis.error=null;globalThis.ran=false;globalThis.loaded=false;
        document.addEventListener('error',event=>{globalThis.error={id:event.target.id,bubbles:event.bubbles,trusted:event.isTrusted}},true);
        addEventListener('load',()=>{globalThis.loaded=globalThis.error!==null});
        </script><script id="resource" ${attributes} src="${source}"></script>
        <script>globalThis.ran=true</script><main>Published document</main>`);
    },
    async (worker) => {
      const response = await scrape(
        worker,
        "({error,ran,loaded,text:document.querySelector('main').textContent})",
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: {
          error: { id: "resource", bubbles: false, trusted: true },
          ran: true,
          loaded: true,
          text: "Published document",
        },
      });
      if (source.startsWith("/")) expect(requests).toEqual(["/", source]);
      else expect(requests).toEqual(["/"]);
    },
  );
});

test("external script load follows its microtasks and precedes window load", async () => {
  await fixture(
    (request) => {
      if (new URL(request.url).pathname === "/script.js")
        return new Response(
          "order.push('script');Promise.resolve().then(()=>order.push('microtask'))",
          { headers: { "content-type": "text/javascript" } },
        );
      return html(
        `<script>globalThis.order=[];document.addEventListener('load',event=>{if(event.target.id==='resource')order.push('script-load')},true);addEventListener('load',()=>order.push('window-load'))</script><script id="resource" src="/script.js"></script>`,
      );
    },
    async (worker) => {
      const response = await scrape(worker, "order");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: ["script", "microtask", "script-load", "window-load"],
      });
    },
  );
});

test("configured scrape deadlines above ten seconds reach the Wasm scheduler", async () => {
  await fixture(
    () => html("<title>Configured deadline</title>"),
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          timeoutMs: 14000,
          expression: "new Promise(resolve=>setTimeout(()=>resolve(document.title),10500))",
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: "Configured deadline" });
    },
  );
}, 16000);

test("async scripts fetch concurrently without blocking parsing or DOMContentLoaded", async () => {
  const slow = Promise.withResolvers<Response>();
  const fast = Promise.withResolvers<Response>();
  const requests: string[] = [];
  await fixture(
    (request) => {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/slow.js") return slow.promise;
      if (path === "/fast.js") return fast.promise;
      if (path === "/parsed") {
        fast.resolve(
          new Response("order.push('fast');fetch('/fast-ran')", {
            headers: { "content-type": "text/javascript" },
          }),
        );
        return new Response("parsed");
      }
      if (path === "/fast-ran") {
        slow.resolve(
          new Response("order.push('slow')", {
            headers: { "content-type": "text/javascript" },
          }),
        );
        return new Response("released");
      }
      return html(`<script>globalThis.order=[];document.addEventListener('DOMContentLoaded',()=>{order.push('dom');fetch('/parsed')});addEventListener('load',()=>order.push('load'))</script>
        <script async src="/slow.js"></script><script async defer src="/fast.js"></script>
        <script>order.push('parser')</script>`);
    },
    async (worker) => {
      const response = await scrape(worker, "({order,ready:document.readyState})");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: { order: ["parser", "dom", "fast", "slow", "load"], ready: "complete" },
      });
      expect(requests).toContain("/slow.js");
      expect(requests).toContain("/fast.js");
      expect(requests).toContain("/parsed");
      expect(requests).toContain("/fast-ran");
    },
  );
});

test("async microtasks can release a pending parser-blocking script", async () => {
  const asynchronous = Promise.withResolvers<Response>();
  const blocking = Promise.withResolvers<Response>();
  await fixture(
    (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/async.js") return asynchronous.promise;
      if (path === "/blocking.js") {
        asynchronous.resolve(
          new Response("Promise.resolve().then(()=>{order.push('async');fetch('/release')})", {
            headers: { "content-type": "text/javascript" },
          }),
        );
        return blocking.promise;
      }
      if (path === "/release") {
        blocking.resolve(
          new Response("order.push('blocking')", {
            headers: { "content-type": "text/javascript" },
          }),
        );
        return new Response("released");
      }
      return html(`<script>globalThis.order=[]</script><script async src="/async.js"></script>
        <script src="/blocking.js"></script><script>order.push('after')</script>`);
    },
    async (worker) => {
      const response = await scrape(worker, "order");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: ["async", "blocking", "after"] });
    },
  );
});

test("timers continue while a parser-blocking external script is pending", async () => {
  const deferred = Promise.withResolvers<Response>();
  await fixture(
    (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/defer.js") return deferred.promise;
      if (path === "/release") {
        deferred.resolve(
          new Response("order.push('defer')", {
            headers: { "content-type": "text/javascript" },
          }),
        );
        return new Response("released");
      }
      return html(`<script>globalThis.order=[];setTimeout(()=>{order.push('timer');fetch('/release')},10)</script>
        <script defer src="/defer.js"></script>`);
    },
    async (worker) => {
      const response = await scrape(worker, "order");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: ["timer", "defer"] });
    },
  );
});

test("inline classic async and defer attributes preserve parser execution", async () => {
  await fixture(
    () =>
      html(`<script async>globalThis.order=['inline'];globalThis.phase=document.readyState</script>
      <script async defer>order.push('next')</script>
      <script type="application/json" async>{}</script>`),
    async (worker) => {
      const response = await scrape(worker, "({order,phase,ready:document.readyState})");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: { order: ["inline", "next"], phase: "loading", ready: "complete" },
      });
    },
  );
});

test("explicit script skipping extracts server HTML without running or loading page scripts", async () => {
  const requests: string[] = [];
  await fixture(
    (request) => {
      requests.push(new URL(request.url).pathname);
      return html(`<h1>Published document</h1><a href="/documents/one">Read document</a>
        <script type="module" async src="/app.js"></script>
        <script async src="/tracking.js"></script>
        <script>document.querySelector('h1').textContent = 'changed'; fetch('/side-effect');</script>`);
    },
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          scripts: "skip",
          expression:
            "({heading: document.querySelector('h1').textContent, href: document.querySelector('a').getAttribute('href'), guest: typeof API_TOKEN})",
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: { heading: "Published document", href: "/documents/one", guest: "undefined" },
      });
      expect(requests).toEqual(["/"]);
      const normal = await scrape(worker, "1");
      expect(normal.status).toBe(422);
      expect(await json(normal)).toMatchObject({
        error: "unsupported: async module script scheduling",
      });
      const invalid = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url: originFor(worker), expression: "1", scripts: "auto" }),
      });
      expect(invalid.status).toBe(400);
      expect(requests).toEqual(["/", "/"]);
    },
  );
});

test("EGRESS forwards through a real workerd service binding and HTTP origin", async () => {
  const requests: string[] = [];
  await fixture(
    (request) => {
      requests.push(request.headers.get("x-nimbo-test-egress") ?? "direct");
      if (
        new URL(request.url).pathname !== "/document" ||
        request.method !== "GET" ||
        request.headers.get("x-nimbo-test-egress") !== "forwarded"
      )
        return new Response("Unexpected transport request", { status: 502 });
      return html(
        '<article>Published through egress</article><script type="module" src="/app.js"></script>',
      );
    },
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: new URL("/document", originFor(worker)).href,
          scripts: "skip",
          expression: "document.querySelector('article').textContent",
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: "Published through egress",
        engine: "rust-wasm-quickjs",
      });
      expect(requests).toEqual(["forwarded"]);
    },
    true,
  );
});

test("instruction and microtask budgets stop loops and release capacity", async () => {
  await fixture(
    () => html("<h1>alive</h1>"),
    async (worker) => {
      const loop = await scrape(worker, "(() => { while (true) {} })()");
      expect(loop.status).toBe(422);
      expect(JSON.stringify(await json(loop))).toContain("limit");
      const jobs = await scrape(
        worker,
        "new Promise(() => { const loop = () => Promise.resolve().then(loop); loop(); })",
      );
      expect(jobs.status).toBe(422);
      expect(JSON.stringify(await json(jobs))).toContain("microtask");
      const healthy = await scrape(worker, "document.querySelector('h1').textContent");
      expect(healthy.status).toBe(200);
      expect(await json(healthy)).toMatchObject({ value: "alive" });
    },
  );
});

test("cross-origin redirects and challenges fail explicitly", async () => {
  await fixture(
    (request) =>
      new URL(request.url).pathname === "/challenge"
        ? html("challenge", { "cf-mitigated": "challenge" })
        : new Response(null, { status: 302, headers: { location: "https://another.test/" } }),
    async (worker) => {
      expect(await json(await scrape(worker, "1"))).toMatchObject({
        error: "cross-origin request blocked",
      });
      const challenged = await scrape(worker, "1", new URL("/challenge", originFor(worker)).href);
      expect(challenged.status).toBe(422);
      expect(await json(challenged)).toMatchObject({ error: "upstream challenge" });
    },
  );
});

test("aggregate HTTP byte limit and input validation release resources", async () => {
  await fixture(
    () => html("x".repeat(2 * 1024 * 1024 + 1)),
    async (worker) => {
      expect((await scrape(worker, "1")).status).toBe(413);
      expect((await scrape(worker, "1", "file:///tmp/secret")).status).toBe(400);
      expect(
        (
          await worker.dispatchFetch("https://nimbo.test/scrape", {
            method: "POST",
            headers: { authorization: "Bearer test-secret" },
            body: "{",
          })
        ).status,
      ).toBe(400);
      expect(
        (await worker.dispatchFetch("https://nimbo.test/scrape", { method: "POST" })).status,
      ).toBe(401);
    },
  );
});

test("page headers, response budget and deadline are per-scrape inputs", async () => {
  await fixture(
    (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/slow") return Bun.sleep(10_500).then(() => html("<title>late</title>"));
      if (path === "/challenge")
        return new Response("wait", { status: 202, headers: { "x-amzn-waf-action": "challenge" } });
      if (path === "/api")
        return Response.json({ language: request.headers.get("accept-language") });
      return html(
        `<title>${request.headers.get("user-agent")}</title>${"x".repeat(2 * 1024 * 1024)}`,
      );
    },
    async (worker) => {
      const send = (input: Record<string, unknown>) =>
        worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), ...input }),
        });
      const headers = { "user-agent": "Example/1.0", "accept-language": "pt-BR" };
      expect((await send({ expression: "document.title", headers })).status).toBe(413);
      const page = await send({
        expression:
          "Promise.all([fetch('/api').then(r=>r.json()),fetch('/challenge').then(r=>[r.status,r.headers.get('x-amzn-waf-action')])]).then(([api,challenge])=>[document.title,api.language,challenge])",
        headers,
        maxResponseBytes: 3 * 1024 * 1024,
      });
      expect(await json(page)).toMatchObject({
        value: ["Example/1.0", "pt-BR", [202, "challenge"]],
      });
      const slow = new URL("/slow", originFor(worker)).href;
      const late = await send({ url: slow, expression: "document.title", timeoutMs: 20_000 });
      expect(await json(late)).toMatchObject({ value: "late" });
      expect((await send({ maxResponseBytes: 5 * 1024 * 1024, expression: "1" })).status).toBe(400);
    },
  );
}, 30_000);

test("repeated pages have fresh cookies and guest globals", async () => {
  const cookies: (string | null)[] = [];
  await fixture(
    (request) => {
      cookies.push(request.headers.get("cookie"));
      return html("<h1>fresh</h1>", { "set-cookie": "session=private; Path=/" });
    },
    async (worker) => {
      for (let cycle = 0; cycle < 20; cycle++) {
        // Sequential lifecycle checks detect stale state and failed page cleanup.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await scrape(
          worker,
          "[typeof previous, (globalThis.previous = 1), document.cookie.includes('guest='), (document.cookie = 'guest=private; Path=/')]",
        );
        // oxlint-disable-next-line eslint/no-await-in-loop
        expect(await json(response)).toMatchObject({
          value: ["undefined", 1, false, "guest=private; Path=/"],
        });
      }
      expect(cookies).toHaveLength(20);
      expect(cookies.every((cookie) => cookie === null)).toBe(true);
    },
  );
});

test("one active page per isolate rejects excess requests and releases the permit", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await fixture(
    async () => {
      entered.resolve();
      await release.promise;
      return html("<h1>ready</h1>");
    },
    async (worker) => {
      const first = scrape(worker, "1");
      try {
        await entered.promise;
        expect((await scrape(worker, "2")).status).toBe(429);
      } finally {
        release.resolve();
      }
      expect((await first).status).toBe(200);
      expect((await scrape(worker, "3")).status).toBe(200);
    },
  );
});

test("HTTP errors remain fetch responses for guest code", async () => {
  await fixture(
    (request) => {
      if (new URL(request.url).pathname === "/api")
        return new Response("unavailable", { status: 503 });
      return html("<h1>network</h1>");
    },
    async (worker) => {
      const response = await scrape(worker, "fetch('/api').then(response => response.status)");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: 503 });
    },
  );
});

test("Wasm heap limits and interrupted pending fetches leave the isolate usable", async () => {
  await fixture(
    () => html("<h1>alive</h1>"),
    async (worker) => {
      const heap = await scrape(worker, "new Array(10000000).fill('large')");
      expect(heap.status).toBe(422);
      const pending = await scrape(worker, "(() => { fetch('/api'); while (true) {} })()");
      expect(pending.status).toBe(422);
      const healthy = await scrape(worker, "document.querySelector('h1').textContent");
      expect(healthy.status).toBe(200);
      expect(await json(healthy)).toMatchObject({ value: "alive" });
    },
  );
});

test("native option metadata preserves text and live ownership", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/option-metadata.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=optionMetadataCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 45, failed: [] } });
    },
  );
});

test("native select state observes defaults, live options and owned reset", async () => {
  const source = await Bun.file(join(root, "crates/engine/tests/fixtures/select-state.txt")).text();
  await fixture(
    () => html("<!doctype html><body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=selectStateCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 72, failed: [] } });
    },
  );
});

test("named collections use current state after DOMString conversion", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/collection-names.txt"),
  ).text();
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=collectionNamesCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 19, failed: [] } });
    },
  );
});

test("selected named lookup avoids handles for unmatched options", async () => {
  const options = Array.from(
    { length: 1000 },
    (_, index) => `<option selected id=o${index}>${index}</option>`,
  ).join("");
  await fixture(
    () => html(`<select multiple id=s>${options}</select>`),
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          expression: "document.getElementById('s').selectedOptions.namedItem('missing')===null",
          diagnostics: true,
        }),
      });
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        value: true,
        diagnostics: { domHandleCount: 2 },
      });
    },
  );
});

test("collection methods preserve interface brands and generic iteration", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/collection-receivers.txt"),
  ).text();
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=collectionReceiversCase(0);return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 86, failed: [] } });
    },
  );
});

test("collection iteration observes length and inherited indices", async () => {
  const source = await Bun.file(
    join(root, "crates/engine/tests/fixtures/collection-properties.txt"),
  ).text();
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const response = await scrape(
        worker,
        `(()=>{${source};const checks=collectionPropertiesCase();return {count:Object.keys(checks).length,failed:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)}})()`,
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: { count: 38, failed: [] } });
    },
  );
});

test("generic collection forEach remains bounded by original JavaScript fuel", async () => {
  await fixture(
    () => html("<body>fresh</body>"),
    async (worker) => {
      const rejected = await scrape(
        worker,
        "(NodeList.prototype.forEach.call({length:1000000000},()=>{}),true)",
      );
      expect(rejected.status).toBe(422);
      expect(await json(rejected)).toEqual({ error: "resource limit: JavaScript fuel" });
      const recovered = await scrape(worker, "document.body.textContent");
      expect(recovered.status).toBe(200);
      expect(await json(recovered)).toMatchObject({ value: "fresh" });
    },
  );
});

test("Window names follow subtree moves and native attribute nodes", async () => {
  const expression = await Bun.file(
    join(root, "crates/engine/tests/fixtures/window-named-mutations.txt"),
  ).text();
  await fixture(
    () => html("<main>Document</main>"),
    async (worker) => {
      const response = await scrape(worker, expression);
      expect(response.status).toBe(200);
      const result = await json(response);
      if (typeof result !== "object" || result === null) throw new Error("Missing response");
      const checks: unknown = Reflect.get(result, "value");
      if (typeof checks !== "object" || checks === null) throw new Error("Missing Window checks");
      expect(Object.keys(checks)).toHaveLength(17);
      expect(Object.values(checks).every((value) => value === true)).toBe(true);
    },
  );
});

test("detached DOM mutations retain Window name lookup within the default budget", async () => {
  const expression = await Bun.file(
    join(root, "crates/engine/tests/fixtures/window-named-detached.txt"),
  ).text();
  await fixture(
    () => html("<main>Document</main>"),
    async (worker) => {
      const response = await scrape(worker, expression);
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
    },
  );
});

test("classic currentScript and reflected script source follow execution lifetime", async () => {
  const page = await Bun.file(
    join(root, "crates/engine/tests/fixtures/current-script.html"),
  ).text();
  const script = await Bun.file(
    join(root, "crates/engine/tests/fixtures/current-script-source.txt"),
  ).text();
  await fixture(
    (request) => {
      if (new URL(request.url).pathname === "/current-script.js")
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      return html(page);
    },
    async (worker) => {
      const response = await scrape(
        worker,
        "({...scriptChecks,extractionNull:document.currentScript===null})",
      );
      expect(response.status).toBe(200);
      const result = await json(response);
      if (typeof result !== "object" || result === null) throw new Error("Missing response");
      const checks: unknown = Reflect.get(result, "value");
      if (typeof checks !== "object" || checks === null) throw new Error("Missing script checks");
      expect(Object.keys(checks)).toHaveLength(27);
      expect(Object.values(checks).every((value) => value === true)).toBe(true);
    },
  );
});

test.each(["shadow", "detached"] as const)(
  "currentScript respects the %s root at execution entry",
  async (kind) => {
    const pending = Promise.withResolvers<Response>();
    await fixture(
      (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/delayed-current.js") return pending.promise;
        if (path === "/release") {
          pending.resolve(
            new Response(
              `globalThis.currentMatches=document.currentScript===${kind === "shadow" ? "null" : "movedScript"}`,
              { headers: { "content-type": "text/javascript" } },
            ),
          );
          return new Response("released");
        }
        const container =
          kind === "shadow"
            ? "document.getElementById('host').attachShadow({mode:'open'})"
            : "document.createElement('section')";
        return html(`<div id=host></div><script>globalThis.loadedNull=false</script>
          <script id=delayed async src=/delayed-current.js></script>
          <script>globalThis.movedScript=document.getElementById('delayed');
          movedScript.addEventListener('load',()=>{loadedNull=document.currentScript===null});
          (${container}).appendChild(movedScript);fetch('/release')</script>`);
      },
      async (worker) => {
        const response = await scrape(
          worker,
          "({currentMatches,loadedNull,extractionNull:document.currentScript===null})",
        ).finally(() => pending.resolve(new Response("released")));
        expect(response.status).toBe(200);
        expect(await json(response)).toMatchObject({
          value: { currentMatches: true, loadedNull: true, extractionNull: true },
        });
      },
    );
  },
);

test("native tag collection reads fit the default operation budget", async () => {
  const expression = await Bun.file(
    join(root, "crates/engine/tests/fixtures/tag-collection-budget.txt"),
  ).text();
  await fixture(
    () => html("<main>Document</main>"),
    async (worker) => {
      const response = await scrape(worker, expression);
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: true });
    },
  );
});

test("tag collection membership follows native mutations and adoption", async () => {
  const expression = await Bun.file(
    join(root, "crates/engine/tests/fixtures/tag-collection-mutations.txt"),
  ).text();
  await fixture(
    () => html("<main>Document</main>"),
    async (worker) => {
      const response = await scrape(worker, expression);
      expect(response.status).toBe(200);
      const result = await json(response);
      if (typeof result !== "object" || result === null) throw new Error("Missing response");
      const checks: unknown = Reflect.get(result, "value");
      if (typeof checks !== "object" || checks === null)
        throw new Error("Missing collection checks");
      expect(Object.keys(checks)).toHaveLength(23);
      expect(Object.values(checks).every((value) => value === true)).toBe(true);
    },
  );
});

test("cached tag collection reads retain the native operation budget", async () => {
  await fixture(
    () => html("<i>Only</i>"),
    async (worker) => {
      const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({
          url: originFor(worker),
          maxDomOperations: 40,
          expression:
            "(()=>{const tags=document.getElementsByTagName('i');for(let i=0;i<60;i++)if(tags.length!==1)return false;return true})()",
        }),
      });
      expect(response.status).toBe(422);
      expect(JSON.stringify(await json(response))).toContain("DOM operations");
      expect(await json(await scrape(worker, "1"))).toMatchObject({ value: 1 });
    },
  );
});

test.each([
  ["Error", "Promise.reject(new Error('rejected-error-fixture'))", "rejected-error-fixture"],
  ["string", "Promise.reject('rejected-string-fixture')", "rejected-string-fixture"],
  [
    "DOMException",
    "Promise.reject(new DOMException('rejected-dom-fixture','NotAllowedError'))",
    "NotAllowedError: rejected-dom-fixture",
  ],
  [
    "matching promise",
    "Promise.reject(new Error('caught-only-fixture')).catch(()=>{});Promise.reject(new Error('unobserved-only-fixture'))",
    "unobserved-only-fixture",
  ],
  [
    "shared reason",
    "const reason=new Error('shared-rejected-fixture');Promise.reject(reason).catch(()=>{});Promise.reject(reason)",
    "shared-rejected-fixture",
  ],
] as const)("unhandled rejection reasons retain %s diagnostics", async (_kind, source, reason) => {
  await fixture(
    () => html(`<script>${source}</script><main>Recovered</main>`),
    async (worker) => {
      const response = await scrape(worker, "1");
      expect(response.status).toBe(422);
      const result = await json(response);
      expect(JSON.stringify(result)).toContain(reason);
      expect(JSON.stringify(result)).not.toContain("caught-only-fixture");
    },
  );
});

test("a late rejection handler clears only its own native promise", async () => {
  await fixture(
    () =>
      html(
        "<script>const rejected=Promise.reject(new Error('observed-later-fixture'));Promise.resolve().then(()=>rejected.catch(()=>{}))</script><main>Handled</main>",
      ),
    async (worker) => {
      const response = await scrape(worker, "document.querySelector('main').textContent");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ value: "Handled" });
    },
  );
});

test("native cloning preserves detached identity, controls and owned documents", async () => {
  const expression = await Bun.file(
    join(root, "crates/engine/tests/fixtures/clone-node.txt"),
  ).text();
  await fixture(
    () => html("<!doctype html><main>Document</main>"),
    async (worker) => {
      const response = await scrape(worker, expression);
      expect(response.status).toBe(200);
      const result = await json(response);
      if (typeof result !== "object" || result === null) throw new Error("Missing response");
      const checks: unknown = Reflect.get(result, "value");
      if (typeof checks !== "object" || checks === null) throw new Error("Missing clone checks");
      expect(Object.keys(checks)).toHaveLength(33);
      expect(Object.values(checks).every((value) => value === true)).toBe(true);
    },
  );
});

test.each([32, 64])(
  "native clone quota %i preserves the source and recovers on a fresh page",
  async (maxDomNodes) => {
    const expression = await Bun.file(
      join(root, "crates/engine/tests/fixtures/clone-budget.txt"),
    ).text();
    await fixture(
      () => html("<main>Document</main>"),
      async (worker) => {
        const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: JSON.stringify({ url: originFor(worker), expression, maxDomNodes }),
        });
        expect(response.status).toBe(200);
        expect(await json(response)).toMatchObject({ value: true });
        const fresh = await scrape(worker, "document.createElement('div').cloneNode().nodeName");
        expect(fresh.status).toBe(200);
        expect(await json(fresh)).toMatchObject({ value: "DIV" });
      },
    );
  },
);

test("native HTML document factories preserve structure, titles and ownership", async () => {
  const expression = await Bun.file(
    join(root, "crates/engine/tests/fixtures/html-document.txt"),
  ).text();
  await fixture(
    () => html("<main>Active document</main>"),
    async (worker) => {
      const response = await scrape(worker, expression);
      expect(response.status).toBe(200);
      const result = await json(response);
      if (typeof result !== "object" || result === null) throw new Error("Missing response");
      const checks: unknown = Reflect.get(result, "value");
      if (typeof checks !== "object" || checks === null) throw new Error("Missing document checks");
      expect(Object.keys(checks)).toHaveLength(17);
      expect(Object.values(checks).every((value) => value === true)).toBe(true);
    },
  );
});
