import { connect } from "cloudflare:sockets";
import { ScrapeError } from "./protocol";

const encoder = new TextEncoder();
const failed = (reason = "proxy transport failed") => new ScrapeError({ status: 502, reason });
const invalid = () => new ScrapeError({ status: 400, reason: "invalid proxy configuration" });
const limit = () => new ScrapeError({ status: 413, reason: "response/input byte limit" });

function joined(parts: Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

// Retains unread socket bytes across HTTP and SOCKS framing; no per-byte reads.
class Reader {
  private readonly reader: ReadableStreamDefaultReader<unknown>;
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  constructor(stream: ReadableStream<unknown>) {
    this.reader = stream.getReader();
  }
  release(): void {
    this.reader.releaseLock();
  }
  private async refill(): Promise<boolean> {
    if (this.offset < this.buffer.byteLength) return true;
    const { done, value } = await this.reader.read();
    if (done) return false;
    if (!(value instanceof Uint8Array)) throw failed("invalid proxy socket bytes");
    this.buffer = value;
    this.offset = 0;
    return true;
  }
  async exact(length: number): Promise<Uint8Array<ArrayBuffer>> {
    const parts: Uint8Array[] = [];
    let size = 0;
    while (size < length) {
      // Protocol frames must be consumed in order.
      // oxlint-disable-next-line eslint/no-await-in-loop
      if (!(await this.refill())) throw failed("truncated proxy response");
      const count = Math.min(length - size, this.buffer.byteLength - this.offset);
      parts.push(this.buffer.subarray(this.offset, this.offset + count));
      this.offset += count;
      size += count;
    }
    return joined(parts, size);
  }
  async line(): Promise<string> {
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      // Header and chunk lines may span multiple socket reads.
      // oxlint-disable-next-line eslint/no-await-in-loop
      if (!(await this.refill())) throw failed("truncated proxy response");
      const newline = this.buffer.indexOf(10, this.offset);
      const end = newline < 0 ? this.buffer.byteLength : newline + 1;
      const part = this.buffer.subarray(this.offset, end);
      size += part.byteLength;
      if (size > 16384) throw failed("proxy header line limit");
      parts.push(part);
      this.offset = end;
      if (newline >= 0) {
        const bytes = joined(parts, size);
        if (bytes.at(-2) !== 13) throw failed("invalid proxy line framing");
        return Array.from(bytes.subarray(0, size - 2), (byte) => String.fromCharCode(byte)).join(
          "",
        );
      }
    }
  }
  async end(maximum: number): Promise<Uint8Array<ArrayBuffer>> {
    const parts: Uint8Array[] = [];
    let size = 0;
    // Connection-close bodies terminate only at socket EOF.
    // oxlint-disable-next-line eslint/no-await-in-loop
    while (await this.refill()) {
      const part = this.buffer.subarray(this.offset);
      this.offset = this.buffer.byteLength;
      size += part.byteLength;
      if (size > maximum) throw limit();
      parts.push(part);
    }
    return joined(parts, size);
  }
}

async function headers(reader: Reader): Promise<Headers> {
  const result = new Headers();
  let size = 0;
  while (true) {
    // HTTP fields are ordered frames on the same socket.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const line = await reader.line();
    size += line.length + 2;
    if (size > 65536) throw failed("proxy header limit");
    if (!line) return result;
    const colon = line.indexOf(":");
    if (colon < 1 || /^\s/u.test(line)) throw failed("invalid proxy header");
    result.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
}

async function head(reader: Reader): Promise<{ status: number; headers: Headers }> {
  // Bound informational responses before the final HTTP response.
  for (let count = 0; count < 8; count++) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const line = await reader.line();
    const match = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: .*|)$/u.exec(line);
    if (!match) throw failed("invalid proxy HTTP status");
    const status = Number(match[1]);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const fields = await headers(reader);
    if (status === 101) throw failed("proxy protocol upgrade unsupported");
    if (status >= 200) return { status, headers: fields };
  }
  throw failed("proxy informational response limit");
}

async function chunks(reader: Reader, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    // Chunk framing is sequential, including trailers.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const line = await reader.line();
    const hex = line.split(";", 1)[0];
    if (!hex || !/^[0-9a-f]+$/iu.test(hex)) throw failed("invalid proxy chunk size");
    const count = Number.parseInt(hex, 16);
    if (!Number.isSafeInteger(count) || count > maximum - size) throw limit();
    if (count === 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await headers(reader);
      return joined(parts, size);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    parts.push(await reader.exact(count));
    size += count;
    // oxlint-disable-next-line eslint/no-await-in-loop
    const ending = await reader.exact(2);
    if (ending[0] !== 13 || ending[1] !== 10) throw failed("invalid proxy chunk framing");
  }
}

async function response(reader: Reader, maximum: number): Promise<Response> {
  const { status, headers: fields } = await head(reader);
  if (status === 407) throw failed("proxy authentication rejected");
  if ([204, 205, 304].includes(status)) return new Response(null, { status, headers: fields });
  const transfer = fields.get("transfer-encoding");
  const length = fields.get("content-length");
  let body: Uint8Array<ArrayBuffer>;
  if (transfer) {
    if (transfer.toLowerCase() !== "chunked" || length !== null)
      throw failed("unsupported proxy response framing");
    body = await chunks(reader, maximum);
    fields.delete("transfer-encoding");
  } else if (length !== null) {
    if (!/^\d+$/u.test(length)) throw failed("invalid proxy content length");
    const count = Number(length);
    if (!Number.isSafeInteger(count) || count > maximum) throw limit();
    body = await reader.exact(count);
  } else {
    body = await reader.end(maximum);
  }
  const encoding = fields.get("content-encoding")?.toLowerCase();
  if (encoding && encoding !== "identity") {
    if (encoding !== "gzip" && encoding !== "deflate")
      throw failed("unsupported proxy content encoding");
    fields.delete("content-encoding");
    fields.delete("content-length");
    const stream = new Response(body).body;
    if (!stream) throw failed();
    return new Response(stream.pipeThrough(new DecompressionStream(encoding)), {
      status,
      headers: fields,
    });
  }
  return new Response(body, { status, headers: fields });
}

type Configuration = {
  url: URL;
  username: Uint8Array;
  password: Uint8Array;
  authorization: string;
};
function configuration(value: string): Configuration {
  try {
    if (value.length > 8192) throw invalid();
    const url = new URL(value);
    if (
      !["http:", "https:", "socks5h:"].includes(url.protocol) ||
      !url.hostname ||
      !["", "/"].includes(url.pathname) ||
      url.search ||
      url.hash
    )
      throw invalid();
    const username = encoder.encode(decodeURIComponent(url.username));
    const password = encoder.encode(decodeURIComponent(url.password));
    if (url.protocol === "socks5h:" && (username.byteLength > 255 || password.byteLength > 255))
      throw invalid();
    const encoded = encoder.encode(
      `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
    );
    const authorization =
      url.username || url.password
        ? `Basic ${btoa(Array.from(encoded, (byte) => String.fromCharCode(byte)).join(""))}`
        : "";
    return { url, username, password, authorization };
  } catch {
    throw invalid();
  }
}

async function socks(
  reader: Reader,
  write: (bytes: Uint8Array) => Promise<void>,
  config: Configuration,
  destination: URL,
): Promise<void> {
  const authenticated = config.username.byteLength > 0 || config.password.byteLength > 0;
  await write(new Uint8Array([5, 1, authenticated ? 2 : 0]));
  const choice = await reader.exact(2);
  if (choice[0] !== 5 || choice[1] !== (authenticated ? 2 : 0))
    throw failed("proxy authentication rejected");
  if (authenticated) {
    await write(
      joined(
        [
          new Uint8Array([1, config.username.byteLength]),
          config.username,
          new Uint8Array([config.password.byteLength]),
          config.password,
        ],
        3 + config.username.byteLength + config.password.byteLength,
      ),
    );
    const auth = await reader.exact(2);
    if (auth[0] !== 1 || auth[1] !== 0) throw failed("proxy authentication rejected");
  }
  const name = encoder.encode(destination.hostname.replace(/^\[|\]$/gu, ""));
  const port = Number(destination.port || (destination.protocol === "https:" ? 443 : 80));
  if (name.byteLength > 255) throw failed("proxy destination hostname limit");
  await write(
    joined(
      [
        new Uint8Array([5, 1, 0, 3, name.byteLength]),
        name,
        new Uint8Array([Math.floor(port / 256), port % 256]),
      ],
      7 + name.byteLength,
    ),
  );
  const reply = await reader.exact(4);
  if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0)
    throw failed("SOCKS proxy connection rejected");
  const kind = reply[3];
  if (kind === 1) await reader.exact(6);
  else if (kind === 4) await reader.exact(18);
  else if (kind === 3) {
    const length = await reader.exact(1);
    await reader.exact((length[0] ?? 0) + 2);
  } else throw failed("invalid SOCKS proxy response");
}

export class ProxyTransport {
  private readonly config: Configuration;
  constructor(value: string) {
    this.config = configuration(value);
  }
  async fetch(request: Request, maximum: number): Promise<Response> {
    const config = this.config;
    const destination = new URL(request.url);
    if (config.url.protocol === "https:" && destination.protocol === "https:")
      throw failed("nested proxy TLS unsupported");
    let socket: Socket = connect(
      {
        hostname: config.url.hostname.replace(/^\[|\]$/gu, ""),
        port: Number(
          config.url.port ||
            (config.url.protocol === "http:" ? 80 : config.url.protocol === "https:" ? 443 : 1080),
        ),
      },
      {
        secureTransport: config.url.protocol === "https:" ? "on" : "starttls",
        allowHalfOpen: false,
      },
    );
    const close = () => {
      void socket.close().catch(() => {});
    };
    // Cancellation can reject closed independently of opened/readable.
    void socket.closed.catch(() => {});
    request.signal.addEventListener("abort", close, { once: true });
    let reader: Reader | undefined;
    const write = async (bytes: Uint8Array) => {
      const writer = socket.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    };
    try {
      if (request.signal.aborted) throw failed("proxy request aborted");
      await socket.opened;
      reader = new Reader(socket.readable);
      if (config.url.protocol === "socks5h:") await socks(reader, write, config, destination);
      else if (destination.protocol === "https:") {
        const authority = `${destination.hostname}:${destination.port || 443}`;
        await write(
          encoder.encode(
            `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${config.authorization ? `Proxy-Authorization: ${config.authorization}\r\n` : ""}\r\n`,
          ),
        );
        const { status } = await head(reader);
        if (status !== 200) throw failed("proxy CONNECT rejected");
      }
      if (destination.protocol === "https:") {
        reader.release();
        reader = undefined;
        socket = socket.startTls({
          expectedServerHostname: destination.hostname.replace(/^\[|\]$/gu, ""),
        });
        void socket.closed.catch(() => {});
        await socket.opened;
        reader = new Reader(socket.readable);
      }
      const fields = new Headers(request.headers);
      fields.set("host", destination.host);
      fields.set("connection", "close");
      fields.delete("proxy-authorization");
      fields.delete("proxy-connection");
      const body = new Uint8Array(await request.arrayBuffer());
      if (request.method === "POST") fields.set("content-length", String(body.byteLength));
      else fields.delete("content-length");
      const forward = config.url.protocol !== "socks5h:" && destination.protocol === "http:";
      if (forward && config.authorization) fields.set("proxy-authorization", config.authorization);
      destination.hash = "";
      const target = forward ? destination.href : destination.pathname + destination.search;
      const lines = Array.from(fields, ([name, value]) => `${name}: ${value}\r\n`).join("");
      await write(encoder.encode(`${request.method} ${target} HTTP/1.1\r\n${lines}\r\n`));
      if (body.byteLength) await write(body);
      return await response(reader, maximum);
    } catch (error) {
      if (error instanceof ScrapeError) throw error;
      throw failed();
    } finally {
      request.signal.removeEventListener("abort", close);
      reader?.release();
      await socket.close().catch(() => {});
    }
  }
}
