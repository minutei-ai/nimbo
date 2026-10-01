import { Data, Schema } from "effect";

export class ScrapeError extends Data.TaggedError("ScrapeError")<{
  readonly status: number;
  readonly reason: string;
}> {}

export const Input = Schema.Struct({ url: Schema.String, expression: Schema.String });
export const Action = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("request"),
    url: Schema.String,
    method: Schema.Literals(["GET", "POST"]),
    body: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("ready") }),
  Schema.Struct({ type: Schema.Literal("result"), json: Schema.String }),
]);
export const Limits = Schema.Struct({
  timeoutMs: Schema.Finite,
  maxResponseBytes: Schema.Finite,
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
}

export const failure = (cause: unknown, status = 422): ScrapeError =>
  cause instanceof ScrapeError
    ? cause
    : new ScrapeError({ status, reason: cause instanceof Error ? cause.message : String(cause) });
