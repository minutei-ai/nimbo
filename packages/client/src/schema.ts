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
    Schema.Struct({
      type: Schema.Literal("settled"),
      horizonMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
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

export const ResponseProjection = Schema.Struct({
  url: Schema.String,
  omitJsonKeys: Schema.NonEmptyArray(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  ).check(Schema.isMaxLength(64)),
  maxReceivedBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 * 1024 * 1024 })),
});

export const CookieState = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter(
    (state) =>
      new TextEncoder().encode(state).byteLength <= 256 * 1024 || "at most 256 KiB of cookie state",
  ),
);

export const Input = Schema.Struct({
  url: Schema.String,
  expression: Schema.String,
  diagnostics: Schema.optional(Schema.Boolean),
  /** Return bounded page console records, including failed executions. */
  captureConsole: Schema.optional(Schema.Boolean),
  captureCookieState: Schema.optional(Schema.Boolean),
  cookieState: Schema.optional(CookieState),
  responseProjection: Schema.optional(ResponseProjection),
  maxInitialDomNodes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 })),
  ),
  maxDomNodes: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 }))),
  media: Schema.optional(Media),
  maxStylesheetBytes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 * 1024 * 1024 })),
  ),
  maxStylesheetSelectors: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32768 })),
  ),
  maxLayoutNodes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 })),
  ),
  maxDomOperations: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
  ),
  scripts: Schema.optional(Schema.Literals(["execute", "skip"])),
  waitFor: Schema.optional(Readiness),
  /** Whole-scrape deadline; defaults to the engine's 10 seconds. */
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60_000 }))),
  maxRequests: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 }))),
  /** Response byte budget for the page and its requests; defaults to 2 MiB. */
  maxResponseBytes: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 * 1024 * 1024 })),
  ),
  /** Headers sent with every page request, such as `user-agent` or `accept-language`. */
  headers: Schema.optional(
    Schema.Record(Schema.String, Schema.String).check(
      Schema.makeFilter((headers) => Object.keys(headers).length <= 32 || "at most 32 headers"),
    ),
  ),
});

export type ScrapeInput = typeof Input.Encoded;

/** Bounded printable records explicitly requested by the caller. */
export const ConsoleMessages = Schema.Array(
  Schema.Struct({
    level: Schema.Literals(["debug", "error", "info", "log", "warn", "assert"]),
    text: Schema.String,
  }),
);

/** A successful extraction. `value` is the JSON result of the expression. */
export const Success = Schema.Struct({
  url: Schema.String,
  value: Schema.Unknown,
  engine: Schema.String,
  cookieState: Schema.optional(CookieState),
  diagnostics: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  console: Schema.optional(ConsoleMessages),
});
export type ScrapeResult = typeof Success.Type;

/** A failed extraction, with page console records only when explicitly requested. */
export const Failure = Schema.Struct({
  error: Schema.String,
  diagnostics: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  console: Schema.optional(ConsoleMessages),
});

/** HTTP status and JSON body, as returned by the RPC entrypoint. */
export const Outcome = Schema.Struct({ status: Schema.Int, body: Schema.Unknown });

export const Health = Schema.Struct({
  engine: Schema.String,
  version: Schema.String,
  limits: Schema.Unknown,
});
export type EngineHealth = typeof Health.Type;
