import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createSecureServer,
  type IncomingHttpHeaders,
  type ServerHttp2Session,
  type ServerHttp2Stream,
} from "node:http2";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const binary = process.argv[2];
assert.ok(binary, "missing native engine binary");
const directory = await mkdtemp(join(tmpdir(), "nimbo-http2-"));
const key = join(directory, "key.pem");
const cert = join(directory, "cert.pem");
const ca = join(directory, "ca.pem");
const requests: Array<{
  path: IncomingHttpHeaders[":path"];
  method: IncomingHttpHeaders[":method"];
  cookie: IncomingHttpHeaders["cookie"];
  body: string;
}> = [];
const sessions = new Set<ServerHttp2Session>();
const server = createSecureServer({ allowHTTP1: true });

try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "ca-key.pem"),
      "-out",
      ca,
      "-days",
      "1",
      "-subj",
      "/CN=Nimbo synthetic test CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      join(directory, "request.pem"),
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" },
  );
  await writeFile(
    join(directory, "extensions.cnf"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n",
  );
  execFileSync(
    "openssl",
    [
      "x509",
      "-req",
      "-in",
      join(directory, "request.pem"),
      "-CA",
      ca,
      "-CAkey",
      join(directory, "ca-key.pem"),
      "-CAcreateserial",
      "-out",
      cert,
      "-days",
      "1",
      "-extfile",
      join(directory, "extensions.cnf"),
    ],
    { stdio: "ignore" },
  );
  server.setSecureContext({ key: await readFile(key), cert: await readFile(cert) });
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  server.on("request", (request, response) => {
    if (request.httpVersionMajor === 2) return;
    response.writeHead(403, { "content-type": "text/plain" });
    response.end("HTTP/2 required");
  });
  server.on("stream", (stream: ServerHttp2Stream, headers) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const path = headers[":path"];
      const body = Buffer.concat(chunks).toString();
      requests.push({ path, method: headers[":method"], cookie: headers.cookie, body });
      if (!headers["accept-encoding"]?.includes("gzip")) {
        stream.respond({ ":status": 403, "content-type": "text/plain" });
        stream.end("compressed responses required");
        return;
      }
      const routes: Record<string, readonly [string, string]> = {
        "/": [
          "text/html",
          '<!doctype html><link rel="stylesheet" href="/style.css"><body><main id="value"></main><script src="/boot.js"></script>',
        ],
        "/style.css": ["text/css", "#value{width:24px}"],
        "/boot.js": [
          "text/javascript",
          "globalThis.result=fetch('/data',{method:'POST',body:'payload'}).then(r=>r.json()).then(v=>{document.querySelector('#value').textContent=v.value;return v.value})",
        ],
        "/data": ["application/json", JSON.stringify({ value: "h2-gzip" })],
      };
      assert.ok(path, "missing request path");
      const route = routes[path];
      assert.ok(route, "unexpected fixture request");
      stream.respond({
        ":status": 200,
        "content-type": route[0],
        "content-encoding": "gzip",
        "set-cookie": "native=h2; Path=/",
      });
      stream.end(gzipSync(route[1]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object", "missing fixture address");
  const environment: NodeJS.ProcessEnv = { ...process.env, SSL_CERT_FILE: ca };
  delete environment.NIMBO_PROXY_URL;
  const { stdout } = await promisify(execFile)(
    binary,
    [
      `https://localhost:${address.port}/`,
      "result.then(value=>({value,text:document.querySelector('#value').textContent,cookie:document.cookie,width:getComputedStyle(document.querySelector('#value')).width}))",
    ],
    { env: environment, timeout: 15000 },
  );
  assert.deepEqual(JSON.parse(stdout), {
    value: "h2-gzip",
    text: "h2-gzip",
    cookie: "native=h2",
    width: "24px",
  });
  assert.deepEqual(
    requests.find((request) => request.path === "/data"),
    { path: "/data", method: "POST", cookie: "native=h2", body: "payload" },
  );
  assert.ok(requests.some((request) => request.path === "/boot.js"));
  assert.ok(requests.some((request) => request.path === "/style.css"));
  console.log(JSON.stringify({ requests: requests.length, protocol: "h2", encoding: "gzip" }));
} finally {
  for (const session of sessions) session.destroy();
  server.close();
  await rm(directory, { recursive: true, force: true });
}
