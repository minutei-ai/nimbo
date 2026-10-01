import { CookieJar } from "tough-cookie";
import { ScrapeError, type Egress, type EngineLimits } from "./protocol";

export async function readBody(
  message: Request | Response,
  maximum: number,
): Promise<{ text: string; bytes: number }> {
  const reader = message.body?.getReader();
  if (!reader) return { text: "", bytes: 0 };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      // Reads are intentionally sequential to bound buffering and release the stream on failure.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum)
        throw new ScrapeError({ status: 413, reason: "response/input byte limit" });
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { text: chunks.join(""), bytes };
  } finally {
    // Cancels unconsumed bodies, including oversized input and decoding failures.
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export class Transport {
  private readonly origin: string;
  private readonly jar = new CookieJar();
  private requests = 0;
  private bytes = 0;
  private readonly encode = new TextEncoder();

  constructor(
    url: string,
    private readonly limits: EngineLimits,
    private readonly egress?: Egress,
  ) {
    this.origin = this.resolve(url).origin;
  }

  private resolve(value: string): URL {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new ScrapeError({ status: 400, reason: "only HTTP(S) without URL credentials" });
    if (this.origin && this.origin !== url.origin)
      throw new ScrapeError({ status: 422, reason: "cross-origin request blocked" });
    return url;
  }

  async request(value: string, method: "GET" | "POST", body: string, signal: AbortSignal) {
    let url = this.resolve(value);
    if (this.encode.encode(body).byteLength > this.limits.maxResponseBytes)
      throw new ScrapeError({ status: 413, reason: "request body limit" });
    for (let redirect = 0; redirect <= 10; redirect++) {
      if (this.requests >= this.limits.maxRequests)
        throw new ScrapeError({ status: 422, reason: "request count limit" });
      this.requests++;
      const headers = new Headers({ "user-agent": "Nimbo/0.1", accept: "*/*" });
      const cookie = this.jar.getCookieStringSync(url.href);
      if (cookie) headers.set("cookie", cookie);
      const request = new Request(url, {
        method,
        headers,
        redirect: "manual",
        signal,
        ...(method === "POST" ? { body } : {}),
      });
      // Each physical request, including redirects, consumes the same page budget.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const response = await (this.egress ? this.egress.fetch(request) : fetch(request));
      try {
        for (const setCookie of response.headers.getSetCookie())
          this.jar.setCookieSync(setCookie, url.href, { ignoreError: true });
        const cookies = this.jar.serializeSync()?.cookies ?? [];
        if (
          cookies.length > 128 ||
          this.encode.encode(JSON.stringify(cookies)).byteLength > 64 * 1024
        )
          throw new ScrapeError({ status: 422, reason: "cookie budget limit" });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
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
        if (
          response.headers.get("cf-mitigated") === "challenge" ||
          response.headers.get("x-amzn-waf-action") === "challenge"
        )
          throw new ScrapeError({ status: 422, reason: "upstream challenge" });
        // oxlint-disable-next-line eslint/no-await-in-loop
        const result = await readBody(response, this.limits.maxResponseBytes - this.bytes);
        this.bytes += result.bytes;
        return {
          url: url.href,
          status: response.status,
          body: result.text,
          content_type: response.headers.get("content-type") ?? "",
        };
      } finally {
        // A redirect or policy failure must not retain a connection slot.
        // oxlint-disable-next-line eslint/no-await-in-loop
        if (!response.bodyUsed) await response.body?.cancel();
      }
    }
    throw new ScrapeError({ status: 422, reason: "redirect count limit" });
  }
}
