import { Cause, Data, Schema } from "effect";

export { Input, Media, Readiness } from "@nimbo/client/schema";

export class ScrapeError extends Data.TaggedError("ScrapeError")<{
  readonly status: number;
  readonly reason: string;
  readonly code?: "url-policy";
}> {}

export function completionFailure(cause: unknown, cancelled: boolean): ScrapeError {
  if (cancelled) return new ScrapeError({ status: 499, reason: "scrape cancelled" });
  if (cause instanceof ScrapeError) return cause;
  if (Cause.isTimeoutError(cause))
    return new ScrapeError({ status: 504, reason: "scrape deadline or invalid input" });
  return new ScrapeError({ status: 500, reason: "scrape execution failed" });
}

export const Action = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("request"),
    id: Schema.Int,
    url: Schema.String,
    method: Schema.Literals(["GET", "POST"]),
    body: Schema.String,
    binary: Schema.Boolean,
    headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
    rejectRedirects: Schema.Boolean,
    allowCrossOrigin: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal("ready") }),
  Schema.Struct({ type: Schema.Literal("await"), milliseconds: Schema.NullOr(Schema.Finite) }),
  Schema.Struct({ type: Schema.Literal("wait"), milliseconds: Schema.Finite }),
  Schema.Struct({ type: Schema.Literal("result"), json: Schema.String }),
]);
export interface FetchOptions {
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly rejectRedirects: boolean;
  readonly allowCrossOrigin?: boolean | undefined;
}
export const Limits = Schema.Struct({
  timeoutMs: Schema.Finite,
  maxResponseBytes: Schema.Finite,
  maxStylesheetBytes: Schema.Finite,
  maxLayoutNodes: Schema.Finite,
  maxRequests: Schema.Finite,
  maxExpressionBytes: Schema.Finite,
});
export type EngineLimits = typeof Limits.Type;

export interface Egress {
  fetch(request: Request): Promise<Response>;
}
export interface Environment {
  readonly API_TOKEN?: string;
  readonly EGRESS?: Egress;
  readonly PROXY_URL?: string;
  readonly TLS_CA_CERTIFICATES?: string;
}

export const failure = (cause: unknown, status = 422): ScrapeError =>
  cause instanceof ScrapeError
    ? cause
    : new ScrapeError({ status, reason: cause instanceof Error ? cause.message : String(cause) });
