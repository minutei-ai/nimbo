import { Data, Schema } from "effect";

export class ScrapeError extends Data.TaggedError("ScrapeError")<{
  readonly status: number;
  readonly reason: string;
}> {}

const Dimension = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16384 }));
export const Media = Schema.Struct({
  width: Schema.optional(Dimension),
  height: Schema.optional(Dimension),
  defaultFontSize: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 512 })),
  ),
  colorScheme: Schema.optional(Schema.Literals(["light", "dark"])),
  reducedMotion: Schema.optional(Schema.Boolean),
});

export const Input = Schema.Struct({
  url: Schema.String,
  expression: Schema.String,
  media: Schema.optional(Media),
  scripts: Schema.optional(Schema.Literals(["execute", "skip"])),
});
export const Action = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("request"),
    url: Schema.String,
    method: Schema.Literals(["GET", "POST"]),
    body: Schema.String,
    binary: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("ready") }),
  Schema.Struct({ type: Schema.Literal("wait"), milliseconds: Schema.Finite }),
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
