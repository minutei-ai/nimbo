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
  const origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: serve });
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
  expect(Object.keys(counters)).toHaveLength(8);
  expect(
    Object.values(counters).every(
      (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    ),
  ).toBe(true);
  const used: unknown = Reflect.get(counters, "javascriptUsedBytes");
  if (typeof used !== "number") throw new Error("Missing heap measurement");
  return used;
}

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
      expect(await json(await worker.dispatchFetch("https://nimbo.test/health"))).toEqual({
        engine: "rust-wasm-quickjs",
        version: "0.1.0",
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

test("explicit script skipping extracts server HTML without running or loading page scripts", async () => {
  const requests: string[] = [];
  await fixture(
    (request) => {
      requests.push(new URL(request.url).pathname);
      return html(`<h1>Published document</h1><a href="/documents/one">Read document</a>
        <script type="module" src="/app.js"></script>
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
      expect(await json(normal)).toMatchObject({ error: "unsupported: async script scheduling" });
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
