import assert from "node:assert/strict";
import { Success } from "@nimbo/client/schema";
import { Schema } from "effect";
import { startCdpBrowser } from "./benchmark-cdp";
import { startCelld } from "./benchmark-celld";
import { fetchJsonHooksFixture } from "./fetch-json-hooks-fixture";

const binary = process.env.NIMBO_COMPARE_CHROMIUM_BINARY;
if (!binary) throw new Error("Set NIMBO_COMPARE_CHROMIUM_BINARY to ordinary Chromium");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) =>
    (await fetchJsonHooksFixture(request)) ?? new Response("Not found", { status: 404 }),
});
const browser = await startCdpBrowser(binary);
try {
  const celld = await startCelld();
  try {
    const results = await Array.fromAsync(
      ["baseline", "array", "object", "stringify"],
      async (mode) => {
        const url = new URL(`/fetch-json-hooks/${mode}`, server.url).href;
        const reference = await browser.extract(url, "comparison");
        assert.equal(reference, "value|payload");
        const response = await fetch(new URL("/scrape", celld.endpoint), {
          method: "POST",
          headers: { authorization: `Bearer ${celld.token}`, "content-type": "application/json" },
          body: JSON.stringify({ url, expression: "comparison" }),
        });
        assert.equal(response.status, 200);
        const body: unknown = await response.json();
        const native = Schema.decodeUnknownSync(Success)(body).value;
        assert.equal(native, reference);
        return { mode, reference, native };
      },
    );
    process.stdout.write(`${JSON.stringify({ reference: browser.version, results }, null, 2)}\n`);
  } finally {
    await celld.stop();
  }
} finally {
  await browser.stop();
  await server.stop(true);
}
