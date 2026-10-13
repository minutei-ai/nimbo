import { expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";

test.each(["timer", "http", "body", "readiness"])(
  "client disconnect interrupts %s and releases Worker capacity",
  async (phase) => {
    const entered = Promise.withResolvers<void>();
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/body") {
          let sent = false;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller): Promise<void> {
                if (!sent) {
                  sent = true;
                  controller.enqueue(
                    new TextEncoder().encode("<!doctype html><title>partial</title>"),
                  );
                  return Promise.resolve();
                }
                entered.resolve();
                return new Promise<void>(() => {});
              },
            }),
            { headers: { "content-type": "text/html" } },
          );
        }
        if (path === "/hang") {
          entered.resolve();
          return new Promise<Response>(() => {});
        }
        if (path === "/entered") {
          entered.resolve();
          return new Response("entered");
        }
        return new Response("<!doctype html><title>fresh</title><body></body>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    const worker = new Miniflare({
      modules: [
        { type: "ESModule", path: join(import.meta.dir, "../dist/worker/index.js") },
        {
          type: "CompiledWasm",
          path: join(import.meta.dir, "../dist/worker/nimbo_engine_bg.wasm"),
        },
      ],
      compatibilityDate: "2026-07-30",
      compatibilityFlags: ["enable_request_signal"],
      bindings: { API_TOKEN: "test-secret" },
    });
    const client = new AbortController();
    try {
      const endpoint = new URL("/scrape", await worker.ready);
      const options = {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      };
      // Use the real HTTP listener so closing the client reaches the incoming Request.signal.
      const pending = fetch(endpoint, {
        ...options,
        signal: client.signal,
        body: JSON.stringify({
          url: phase === "body" ? new URL("/body", origin.url).href : origin.url.href,
          ...(phase === "readiness"
            ? {
                waitFor: {
                  condition: {
                    type: "predicate",
                    expression:
                      "(()=>{if(!globalThis.entered){globalThis.entered=true;fetch('/entered')}return false})()",
                  },
                  timeoutMs: 10000,
                  pollIntervalMs: 1,
                },
              }
            : {}),
          expression:
            phase === "http"
              ? "fetch('/hang')"
              : phase === "readiness" || phase === "body"
                ? "1"
                : "fetch('/entered').then(()=>new Promise(resolve=>setTimeout(()=>resolve(1),60000)))",
        }),
      }).then(
        (response) => response.status,
        () => 0,
      );
      await entered.promise;
      const started = performance.now();
      client.abort();
      expect(await pending).toBe(0);
      const recovered = await fetch(endpoint, {
        ...options,
        signal: AbortSignal.timeout(2000),
        body: JSON.stringify({
          url: origin.url.href,
          expression: "({title:document.title,entered:typeof entered})",
        }),
      });
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        value: { title: "fresh", entered: "undefined" },
      });
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      client.abort();
      await worker.dispose();
      await origin.stop(true);
    }
  },
  15000,
);
