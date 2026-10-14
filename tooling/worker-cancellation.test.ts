import { expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";

test.each([
  { phase: "timer", diagnostics: false },
  ...["timer", "http", "body", "readiness", "parsing"].map((phase) => ({
    phase,
    diagnostics: true,
  })),
])(
  "client disconnect interrupts $phase (diagnostics=$diagnostics) and releases Worker capacity",
  async ({ phase, diagnostics }) => {
    const record = Promise.withResolvers<string>();
    const messages: string[] = [];

    const entered = Promise.withResolvers<void>();
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/parsing") {
          const body = `<!doctype html><body>${"<div>".repeat(60000)}x${"</div>".repeat(60000)}`;
          entered.resolve();
          return new Response(body, { headers: { "content-type": "text/html" } });
        }
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
      handleStructuredLogs: ({ message }) => {
        if (message.includes('"event":"nimbo.scrape.cancelled"')) {
          messages.push(message);
          record.resolve(message);
        }
      },
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
          diagnostics,
          url: new URL(
            phase === "body" ? "/body" : phase === "parsing" ? "/parsing" : "/",
            origin.url,
          ).href,
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
              : phase === "readiness" || phase === "body" || phase === "parsing"
                ? "1"
                : "fetch('/entered').then(()=>new Promise(resolve=>setTimeout(()=>resolve(1),60000)))",
        }),
      }).then(
        (response) => response.status,
        () => 0,
      );
      await entered.promise;
      if (phase === "timer" || phase === "readiness") {
        // The marker arrives before its HTTP response is consumed. Let the calling
        // operation resume its wait; its cancellation record must confirm that phase.
        await Bun.sleep(50);
      }
      if (phase === "parsing") {
        // The origin has returned its complete local body; let initial parsing advance.
        await Bun.sleep(200);
        const busy = await fetch(endpoint, {
          ...options,
          body: JSON.stringify({ url: origin.url.href, expression: "1" }),
        });
        expect(busy.status).toBe(429);
      }
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
      if (diagnostics) {
        const message = await Promise.race([record.promise, Bun.sleep(2000).then(() => "missing")]);
        const hostPhase =
          phase === "timer"
            ? "extraction"
            : phase === "http"
              ? "resource"
              : phase === "body"
                ? "navigation"
                : phase;
        expect(message).toContain(`"phase":"${hostPhase}"`);
        expect(message).toContain('"cancelled":true');
        if (phase === "timer" || phase === "http")
          expect(message).toContain('"enginePhase":"evaluating"');
        if (phase === "readiness") expect(message).toContain('"enginePhase":"waiting"');
        expect(message).not.toContain(origin.url.href);
        expect(message).not.toContain("test-secret");
        expect(messages).toHaveLength(1);
      } else expect(messages).toHaveLength(0);
    } finally {
      client.abort();
      await worker.dispose();
      await origin.stop(true);
    }
  },
  15000,
);
