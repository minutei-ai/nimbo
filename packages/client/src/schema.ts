import { Schema } from "effect";

// Shared by the Worker and its clients, so both validate the same request shape.
const Dimension = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16384 }));
export const Readiness = Schema.Struct({
  condition: Schema.Union([
    Schema.Struct({ type: Schema.Literal("selector"), selector: Schema.String }),
    Schema.Struct({ type: Schema.Literal("predicate"), expression: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("networkIdle"),
      quietMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
    }),
  ]),
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  pollIntervalMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
});
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
  diagnostics: Schema.optional(Schema.Boolean),
  maxInitialDomNodes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 })),
  ),
  maxDomNodes: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 }))),
  media: Schema.optional(Media),
  maxStylesheetBytes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 * 1024 * 1024 })),
  ),
  maxLayoutNodes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 })),
  ),
  maxDomOperations: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
  ),
  scripts: Schema.optional(Schema.Literals(["execute", "skip"])),
  waitFor: Schema.optional(Readiness),
});

export type ScrapeInput = typeof Input.Encoded;

/** A successful extraction. `value` is the JSON result of the expression. */
export const Success = Schema.Struct({
  url: Schema.String,
  value: Schema.Unknown,
  engine: Schema.String,
  diagnostics: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type ScrapeResult = typeof Success.Type;

/** A failed extraction: `error` is a fixed reason without page data. */
export const Failure = Schema.Struct({
  error: Schema.String,
  diagnostics: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

/** HTTP status and JSON body, as returned by the RPC entrypoint. */
export const Outcome = Schema.Struct({ status: Schema.Int, body: Schema.Unknown });

export const Health = Schema.Struct({
  engine: Schema.String,
  version: Schema.String,
  limits: Schema.Unknown,
});
export type EngineHealth = typeof Health.Type;
