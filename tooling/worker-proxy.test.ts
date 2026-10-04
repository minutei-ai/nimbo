import { expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { Schema } from "effect";

const root = join(import.meta.dir, "..");
const Metadata = Schema.Struct({
  ca: Schema.String,
  http_port: Schema.Int,
  https_port: Schema.Int,
  proxies: Schema.Array(Schema.Struct({ mode: Schema.String, url: Schema.String })),
});
const Stats = Schema.Struct({
  requests: Schema.Int,
  credential_leaks: Schema.Int,
  bad_posts: Schema.Int,
  missing_cookies: Schema.Int,
});

async function fixture(
  run: (metadata: typeof Metadata.Type, stats: () => Promise<typeof Stats.Type>) => Promise<void>,
) {
  const child = Bun.spawn(
    ["python3", "-u", join(root, "tooling/native-proxy-fixture.py"), "--serve"],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  const reader = child.stdout.getReader();
  let buffered = "";
  const line = async (): Promise<string> => {
    while (!buffered.includes("\n")) {
      // Read the owned fixture's ordered control messages.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const { done, value } = await reader.read();
      if (done) throw new Error("Proxy fixture exited before its report");
      buffered += new TextDecoder().decode(value);
    }
    const newline = buffered.indexOf("\n"),
      result = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    return result;
  };
  try {
    const metadata = Schema.decodeSync(Schema.fromJsonString(Metadata))(await line());
    const stats = async () => {
      await child.stdin.write("stats\n");
      await child.stdin.flush();
      return Schema.decodeSync(Schema.fromJsonString(Stats))(await line());
    };
    await run(metadata, stats);
  } finally {
    await child.stdin.end();
    reader.releaseLock();
    const exited = await Promise.race([child.exited, Bun.sleep(5000).then(() => undefined)]);
    if (exited === undefined) {
      child.kill();
      await child.exited;
    }
  }
}

function worker(metadata: typeof Metadata.Type, proxy: string) {
  return new Miniflare({
    modules: [
      { type: "ESModule", path: join(root, "dist/worker/index.js") },
      { type: "CompiledWasm", path: join(root, "dist/worker/nimbo_engine_bg.wasm") },
    ],
    compatibilityDate: "2026-07-30",
    bindings: { API_TOKEN: "test-secret", PROXY_URL: proxy },
    // A real isolated CA, not a disabled TLS verifier or a mocked outbound fetch.
    outboundService: {
      network: {
        allow: ["private"],
        tlsOptions: { trustBrowserCas: false, trustedCertificates: [metadata.ca] },
      },
    },
  });
}

const expression =
  "result.then(v=>({value:v,text:document.querySelector('#value').textContent,suffix:globalThis.suffix,cookie:document.cookie}))";
const scrape = (runtime: Miniflare, url: string, evaluate = expression) =>
  runtime.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: evaluate }),
  });

test("real workerd proxy: HTTP, TLS CONNECT, SOCKS5 remote DNS and credential isolation", async () => {
  await fixture(async (metadata, stats) => {
    for (const config of metadata.proxies) {
      const runtime = worker(metadata, config.url);
      try {
        for (let variant = 0; variant < 64; variant++) {
          const secure = config.mode !== "https-auth" && variant % 2 === 1;
          const url = `${secure ? "https" : "http"}://example.test:${secure ? metadata.https_port : metadata.http_port}/start`;
          // Each request owns a new page through the real Worker HTTP API.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const response = await scrape(runtime, url);
          expect(response.status).toBe(200);
          // oxlint-disable-next-line eslint/no-await-in-loop
          expect(await response.json()).toMatchObject({
            value: {
              value: "through-proxy",
              text: "through-proxy",
              suffix: "module",
              cookie: "transport=retained",
            },
          });
        }
      } finally {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await runtime.dispose();
      }
    }
    expect(await stats()).toMatchObject({
      requests: 2240,
      credential_leaks: 0,
      bad_posts: 0,
      missing_cookies: 0,
    });
  });
}, 120_000);

test("real workerd proxy: JS fetch decodes chunked, gzip and EOF bodies", async () => {
  await fixture(async (metadata, stats) => {
    for (const config of metadata.proxies.filter(
      ({ mode }) => mode === "http-auth" || mode === "socks5h-auth",
    )) {
      const runtime = worker(metadata, config.url);
      try {
        for (let variant = 0; variant < 64; variant++) {
          const secure = variant % 2 === 1;
          const port = secure ? metadata.https_port : metadata.http_port;
          const origin = `${secure ? "https" : "http"}://example.test:${port}`;
          const paths = ["chunked", "gzip", "no-length"];
          const path = paths[variant % paths.length];
          // oxlint-disable-next-line eslint/no-await-in-loop
          const response = await scrape(
            runtime,
            `${origin}/empty`,
            `fetch('/${path}').then(r=>r.text())`,
          );
          expect(response.status).toBe(200);
          // oxlint-disable-next-line eslint/no-await-in-loop
          expect(await response.json()).toMatchObject({ value: "framed-response" });
        }
      } finally {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await runtime.dispose();
      }
    }
    expect(await stats()).toMatchObject({ requests: 256, credential_leaks: 0 });
  });
}, 60_000);

test("real workerd proxy: incorrect authentication never reaches the origin", async () => {
  await fixture(async (metadata, stats) => {
    for (const config of metadata.proxies.filter(({ mode }) => mode.endsWith("auth"))) {
      const proxy = new URL(config.url);
      proxy.username = "incorrect";
      proxy.password = "incorrect";
      const runtime = worker(metadata, proxy.href);
      try {
        for (let attempt = 0; attempt < 8; attempt++) {
          // Repeated failures also verify that page capacity is released.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const response = await scrape(runtime, `http://example.test:${metadata.http_port}/start`);
          expect(response.status).toBe(502);
          // oxlint-disable-next-line eslint/no-await-in-loop
          expect(await response.json()).toEqual({ error: "proxy authentication rejected" });
        }
      } finally {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await runtime.dispose();
      }
    }
    expect(await stats()).toMatchObject({ requests: 0, credential_leaks: 0 });
  });
}, 30_000);

test("real workerd proxy: TLS requires the destination hostname and trusted CA", async () => {
  await fixture(async (metadata, stats) => {
    const config = metadata.proxies.find(({ mode }) => mode === "http");
    if (!config) throw new Error("Missing HTTP proxy fixture");
    const runtime = worker(metadata, config.url);
    try {
      const rejected = await scrape(runtime, `https://mismatch.test:${metadata.https_port}/start`);
      expect(rejected.status).toBe(502);
      expect(await rejected.json()).toEqual({ error: "proxy transport failed" });
      expect(await stats()).toMatchObject({ requests: 0 });
      const recovered = await scrape(runtime, `https://example.test:${metadata.https_port}/start`);
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ value: { value: "through-proxy" } });
    } finally {
      await runtime.dispose();
    }
    const untrusted = new Miniflare({
      modules: [
        { type: "ESModule", path: join(root, "dist/worker/index.js") },
        { type: "CompiledWasm", path: join(root, "dist/worker/nimbo_engine_bg.wasm") },
      ],
      compatibilityDate: "2026-07-30",
      bindings: { API_TOKEN: "test-secret", PROXY_URL: config.url },
      outboundService: { network: { allow: ["private"], tlsOptions: { trustBrowserCas: true } } },
    });
    try {
      const rejected = await scrape(untrusted, `https://example.test:${metadata.https_port}/start`);
      expect(rejected.status).toBe(502);
      expect(await rejected.json()).toEqual({ error: "proxy transport failed" });
      expect(await stats()).toMatchObject({ requests: 7, credential_leaks: 0 });
    } finally {
      await untrusted.dispose();
    }
  });
}, 30_000);

test("real workerd proxy: limits and malformed frames fail and release sockets", async () => {
  await fixture(async (metadata, stats) => {
    const config = metadata.proxies.find(({ mode }) => mode === "socks5h");
    if (!config) throw new Error("Missing SOCKS proxy fixture");
    const runtime = worker(metadata, config.url);
    try {
      const origin = `http://example.test:${metadata.http_port}`;
      const cases = [
        { path: "large", status: 413, error: "response/input byte limit" },
        { path: "gzip-bomb", status: 413, error: "response/input byte limit" },
        { path: "large-header", status: 502, error: "proxy header line limit" },
        { path: "truncated", status: 502, error: "truncated proxy response" },
        { path: "ambiguous", status: 502, error: "unsupported proxy response framing" },
        { path: "malformed-chunk", status: 502, error: "invalid proxy chunk size" },
      ];
      for (let variant = 0; variant < 64; variant++) {
        const scenario = cases[variant % cases.length];
        if (!scenario) throw new Error("Missing failure case");
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await scrape(runtime, `${origin}/${scenario.path}`, "document.title");
        expect(response.status).toBe(scenario.status);
        // oxlint-disable-next-line eslint/no-await-in-loop
        expect(await response.json()).toEqual({ error: scenario.error });
        // oxlint-disable-next-line eslint/no-await-in-loop
        const recovered = await scrape(runtime, `${origin}/empty`, "document.body.textContent");
        expect(recovered.status).toBe(200);
        // oxlint-disable-next-line eslint/no-await-in-loop
        expect(await recovered.json()).toMatchObject({ value: "empty" });
      }
      expect(await stats()).toMatchObject({ requests: 128, credential_leaks: 0 });
    } finally {
      await runtime.dispose();
    }
  });
}, 60_000);

test("real workerd proxy: unsupported nested TLS and local SOCKS DNS stay explicit", async () => {
  await fixture(async (metadata, stats) => {
    const config = metadata.proxies.find(({ mode }) => mode === "https-auth");
    if (!config) throw new Error("Missing HTTPS proxy fixture");
    const runtime = worker(metadata, config.url);
    try {
      const response = await scrape(runtime, `https://example.test:${metadata.https_port}/start`);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "nested proxy TLS unsupported" });
    } finally {
      await runtime.dispose();
    }
    const local = worker(metadata, config.url.replace(/^https:/u, "socks5:"));
    try {
      const response = await scrape(local, `http://example.test:${metadata.http_port}/start`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid proxy configuration" });
    } finally {
      await local.dispose();
    }
    expect(await stats()).toMatchObject({ requests: 0 });
  });
}, 30_000);

test("real workerd proxy: deadline cancels socket reads and releases page capacity", async () => {
  await fixture(async (metadata, stats) => {
    const config = metadata.proxies.find(({ mode }) => mode === "socks5h");
    if (!config) throw new Error("Missing SOCKS proxy fixture");
    const runtime = worker(metadata, config.url);
    try {
      const origin = `http://example.test:${metadata.http_port}`;
      const response = await scrape(runtime, `${origin}/stall`, "document.title");
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: "scrape deadline or invalid input" });
      const recovered = await scrape(runtime, `${origin}/empty`, "document.body.textContent");
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ value: "empty" });
      expect(await stats()).toMatchObject({ requests: 2, credential_leaks: 0 });
    } finally {
      await runtime.dispose();
    }
  });
}, 30_000);
