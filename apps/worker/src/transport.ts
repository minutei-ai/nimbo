import type { ScrapeInput } from "@nimbo/client/schema";
import { ProxyTransport } from "./proxy";
import {
  browser_user_agent,
  decode_response,
  WasmCookies,
  WasmJsonProjection,
} from "../../../dist/wasm/nimbo_engine.js";
import { ScrapeError, type Egress, type EngineLimits, type FetchOptions } from "./protocol";

export async function readBytes(
  message: Request | Response,
  maximum: number,
  charge?: (bytes: number) => void,
): Promise<Uint8Array> {
  const reader = message.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      // Reads are sequential to bound buffering and release the stream on failure.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const part = await reader.read();
      if (part.done) break;
      const value: unknown = part.value;
      if (!(value instanceof Uint8Array))
        throw new ScrapeError({ status: 502, reason: "invalid response bytes" });
      bytes += value.byteLength;
      if (bytes > maximum)
        throw new ScrapeError({ status: 413, reason: "response/input byte limit" });
      charge?.(value.byteLength);
      chunks.push(value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export async function readBody(
  message: Request | Response,
  maximum: number,
): Promise<{ text: string; bytes: number }> {
  const bytes = await readBytes(message, maximum);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), bytes: bytes.byteLength };
}

export class Transport {
  private readonly origin: string;
  private readonly proxy: ProxyTransport | undefined;
  readonly cookies: WasmCookies;

  free(): void {
    this.cookies.free();
  }
  private requests = 0;
  private bytes = 0;
  private projectedBytes = 0;
  private projecting = false;
  private readonly projectionUrl: string | undefined;
  private readonly encode = new TextEncoder();

  constructor(
    url: string,
    private readonly limits: EngineLimits,
    private readonly egress?: Egress,
    proxy?: string,
    private readonly headers: Readonly<Record<string, string>> = {},
    private readonly projection?: ScrapeInput["responseProjection"],
  ) {
    if (proxy !== undefined && egress !== undefined)
      throw new ScrapeError({ status: 400, reason: "configure either proxy or EGRESS" });
    this.proxy = proxy === undefined ? undefined : new ProxyTransport(proxy);
    this.origin = this.resolve(url).origin;
    this.projectionUrl = projection === undefined ? undefined : this.resolve(projection.url).href;
    this.cookies = new WasmCookies();
  }

  private resolve(value: string): URL {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new ScrapeError({
        status: 400,
        reason: "only HTTP(S) without URL credentials",
        code: "url-policy",
      });
    if (this.origin && this.origin !== url.origin)
      throw new ScrapeError({
        status: 422,
        reason: "cross-origin request blocked",
        code: "url-policy",
      });
    return url;
  }

  private async project(
    response: Response,
    projection: NonNullable<ScrapeInput["responseProjection"]>,
  ): Promise<Uint8Array> {
    if (this.projectedBytes >= projection.maxReceivedBytes)
      throw new ScrapeError({ status: 413, reason: "JSON projection received bytes" });
    if (this.bytes >= this.limits.maxResponseBytes)
      throw new ScrapeError({ status: 413, reason: "JSON projection output bytes" });
    const reader = response.body?.getReader();
    try {
      const decoder = new WasmJsonProjection(
        JSON.stringify(projection.omitJsonKeys),
        projection.maxReceivedBytes - this.projectedBytes,
        this.limits.maxResponseBytes - this.bytes,
      );
      try {
        if (reader) {
          while (true) {
            // Sequential reads bound the original response and its native buffer.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const part = await reader.read();
            if (part.done) break;
            const bytes: unknown = part.value;
            if (!(bytes instanceof Uint8Array))
              throw new ScrapeError({ status: 502, reason: "invalid response body chunk" });
            this.projectedBytes += bytes.byteLength;
            if (this.projectedBytes > projection.maxReceivedBytes)
              throw new ScrapeError({ status: 413, reason: "JSON projection received bytes" });
            decoder.feed(bytes);
          }
        }
        const result = decoder.finish();
        this.bytes += result.byteLength;
        if (this.bytes > this.limits.maxResponseBytes)
          throw new ScrapeError({ status: 413, reason: "JSON projection output bytes" });
        return result;
      } finally {
        decoder.free();
      }
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
    }
  }

  async request(
    value: string,
    method: "GET" | "POST",
    body: string,
    signal: AbortSignal,
    binary = false,
    fetch: FetchOptions = { headers: [], rejectRedirects: false },
  ) {
    let url = this.resolve(value);
    if (this.encode.encode(body).byteLength > this.limits.maxResponseBytes)
      throw new ScrapeError({ status: 413, reason: "request body limit" });
    for (let redirect = 0; redirect <= 10; redirect++) {
      if (this.requests >= this.limits.maxRequests)
        throw new ScrapeError({ status: 422, reason: "request count limit" });
      this.requests++;
      const headers = new Headers({
        "user-agent": browser_user_agent(),
        accept: "*/*",
        ...this.headers,
      });
      for (const [name, header] of fetch.headers) headers.set(name, header);
      const cookie = this.cookies.header(url.href);
      if (cookie) headers.set("cookie", cookie);
      const request = new Request(url, {
        method,
        headers,
        redirect: "manual",
        signal,
        ...(method === "POST" ? { body } : {}),
      });
      const projection = this.projection;
      const projected = binary && projection !== undefined && url.href === this.projectionUrl;
      if (projected && this.projecting)
        throw new ScrapeError({ status: 429, reason: "concurrent JSON projection limit" });
      if (projected) this.projecting = true;
      // Each physical request, including redirects, consumes the same page budget.
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await (this.proxy
          ? this.proxy.fetch(
              request,
              projected && projection !== undefined
                ? projection.maxReceivedBytes - this.projectedBytes
                : this.limits.maxResponseBytes - this.bytes,
            )
          : this.egress
            ? this.egress.fetch(request)
            : globalThis.fetch(request));
        try {
          for (const setCookie of response.headers.getSetCookie()) {
            try {
              this.cookies.set(url.href, setCookie);
            } catch {
              throw new ScrapeError({ status: 422, reason: "cookie budget limit" });
            }
          }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (fetch.rejectRedirects)
              throw new ScrapeError({ status: 502, reason: "redirect rejected by fetch" });
            const location = response.headers.get("location");
            if (!location)
              throw new ScrapeError({ status: 502, reason: "redirect without location" });
            url = this.resolve(new URL(location, url).href);
            if (
              response.status === 303 ||
              ([301, 302].includes(response.status) && method === "POST")
            ) {
              method = "GET";
              body = "";
            }
            continue;
          }
          // Page fetches observe challenge responses themselves; navigations fail fast.
          if (
            !binary &&
            (response.headers.get("cf-mitigated") === "challenge" ||
              response.headers.get("x-amzn-waf-action") === "challenge")
          )
            throw new ScrapeError({ status: 422, reason: "upstream challenge" });
          const applyProjection =
            projected &&
            projection !== undefined &&
            response.ok &&
            response.status !== 202 &&
            response.headers.get("cf-mitigated") !== "challenge" &&
            response.headers.get("x-amzn-waf-action") !== "challenge";
          // oxlint-disable-next-line eslint/no-await-in-loop
          const result = await (applyProjection && projection !== undefined
            ? this.project(response, projection)
            : readBytes(response, this.limits.maxResponseBytes - this.bytes, (bytes) => {
                this.bytes += bytes;
                if (this.bytes > this.limits.maxResponseBytes)
                  throw new ScrapeError({ status: 413, reason: "response/input byte limit" });
              }));
          const contentType = applyProjection
            ? "application/json; charset=utf-8"
            : (response.headers.get("content-type") ?? "");
          return {
            url: url.href,
            status: response.status,
            body: binary ? "" : decode_response(result, contentType),
            raw_body: binary ? result : undefined,
            content_type: contentType,
            headers: [...response.headers]
              .filter(
                ([name]) =>
                  name !== "set-cookie" &&
                  (!applyProjection ||
                    !["content-encoding", "content-length", "content-type"].includes(name)),
              )
              .concat(applyProjection ? [["content-type", contentType]] : []),
          };
        } finally {
          // A redirect or policy failure must not retain a connection slot.
          // oxlint-disable-next-line eslint/no-await-in-loop
          if (!response.bodyUsed) await response.body?.cancel();
        }
      } finally {
        if (projected) this.projecting = false;
      }
    }
    throw new ScrapeError({ status: 422, reason: "redirect count limit" });
  }
}
