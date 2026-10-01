import { expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare, type Request as WorkerRequest } from "miniflare";

const root = join(import.meta.dir, "..");
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html", ...headers } });

async function fixture(
  outbound: (request: WorkerRequest) => Response | Promise<Response>,
  run: (worker: Miniflare) => Promise<void>,
) {
  const worker = new Miniflare({
    modules: [
      { type: "ESModule", path: join(root, "dist/worker/index.js") },
      { type: "CompiledWasm", path: join(root, "dist/worker/nimbo_engine_bg.wasm") },
    ],
    compatibilityDate: "2026-07-30",
    bindings: { API_TOKEN: "test-secret" },
    outboundService: outbound,
  });
  try {
    await run(worker);
  } finally {
    await worker.dispose();
  }
}

const scrape = (worker: Miniflare, expression: string, url = "https://source.test/") =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });

const json = async (response: Awaited<ReturnType<typeof scrape>>): Promise<unknown> =>
  response.json();

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
          headers: { location: "/page", "set-cookie": "session=one; HttpOnly; Secure; Path=/" },
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
        url: "https://source.test/page",
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
      const challenged = await scrape(worker, "1", "https://source.test/challenge");
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
        const response = await scrape(worker, "[typeof previous, (globalThis.previous = 1)]");
        // oxlint-disable-next-line eslint/no-await-in-loop
        expect(await json(response)).toMatchObject({ value: ["undefined", 1] });
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
