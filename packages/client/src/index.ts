import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  Failure,
  Health,
  Input,
  Outcome,
  Success,
  type EngineHealth,
  type ScrapeInput,
  type ScrapeResult,
} from "./schema";

import type { EngineBinding } from "./binding";

export type { EngineBinding } from "./binding";
export * from "./schema";

/**
 * A failed call. `status` follows the engine's HTTP semantics: 400 invalid
 * input, 422 unsupported page or engine limit, 429 isolate capacity, 499
 * cancelled, 502 origin transport, 504 deadline. 503 means the engine could
 * not be reached or answered outside the protocol.
 */
export class NimboError extends Data.TaggedError("NimboError")<{
  readonly status: number;
  readonly reason: string;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}> {}

export class Nimbo extends Context.Service<
  Nimbo,
  {
    readonly scrape: (input: ScrapeInput) => Effect.Effect<ScrapeResult, NimboError>;
    readonly health: Effect.Effect<EngineHealth, NimboError>;
  }
>()("@nimbo/client/Nimbo") {}

const unavailable = (cause: unknown) =>
  new NimboError({
    status: 503,
    reason: cause instanceof Error ? cause.message : "engine unavailable",
  });

const protocol = () => new NimboError({ status: 503, reason: "engine protocol mismatch" });

const outcome = (status: number, body: unknown): Effect.Effect<ScrapeResult, NimboError> =>
  status === 200
    ? Schema.decodeUnknownEffect(Success)(body).pipe(Effect.mapError(protocol))
    : Schema.decodeUnknownEffect(Failure)(body).pipe(
        Effect.mapError(protocol),
        Effect.flatMap(({ error, diagnostics }) =>
          Effect.fail(
            new NimboError({
              status,
              reason: error,
              ...(diagnostics === undefined ? {} : { diagnostics }),
            }),
          ),
        ),
      );

// Invalid input fails locally with the engine's 400 instead of a round trip.
const validate = (input: ScrapeInput) =>
  Schema.decodeEffect(Input)(input).pipe(
    Effect.mapError((cause) => new NimboError({ status: 400, reason: cause.message })),
    Effect.flatMap(Schema.encodeEffect(Input)),
    Effect.mapError((cause) =>
      cause instanceof NimboError ? cause : new NimboError({ status: 400, reason: cause.message }),
    ),
  );

/**
 * Calls the engine through a service binding to its `Engine` entrypoint.
 * Bindings are authorized by deployment configuration and carry no token.
 */
export const layerBinding = (binding: EngineBinding): Layer.Layer<Nimbo> =>
  Layer.succeed(Nimbo, {
    scrape: (input) =>
      validate(input).pipe(
        Effect.flatMap((encoded) =>
          Effect.tryPromise({ try: () => binding.scrape(encoded), catch: unavailable }),
        ),
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(Outcome)(raw).pipe(Effect.mapError(protocol)),
        ),
        Effect.flatMap(({ status, body }) => outcome(status, body)),
      ),
    health: Effect.tryPromise({ try: () => binding.health(), catch: unavailable }).pipe(
      Effect.flatMap((raw) =>
        Schema.decodeUnknownEffect(Health)(raw).pipe(Effect.mapError(protocol)),
      ),
    ),
  });

export interface HttpOptions {
  /** Engine base URL, for example `https://engine.example.com`. */
  readonly url: string;
  /** Value of the engine's `API_TOKEN` secret. */
  readonly token: string;
  /** Fetch implementation; defaults to the global `fetch`. */
  readonly fetch?: (input: URL, init: RequestInit) => Promise<Response>;
}

/**
 * Calls the engine over HTTP. Interrupting the effect aborts the request,
 * which the engine observes as client cancellation.
 */
export const layerHttp = (options: HttpOptions): Layer.Layer<Nimbo> => {
  const request = options.fetch ?? ((input: URL, init: RequestInit) => fetch(input, init));
  const call = (path: string, init: RequestInit) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await request(new URL(path, options.url), { ...init, signal });
        const body: unknown = await response.json();
        return { status: response.status, body };
      },
      catch: unavailable,
    });
  return Layer.succeed(Nimbo, {
    scrape: (input) =>
      validate(input).pipe(
        Effect.flatMap((encoded) =>
          call("/scrape", {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(encoded),
          }),
        ),
        Effect.flatMap(({ status, body }) => outcome(status, body)),
      ),
    health: call("/health", { method: "GET" }).pipe(
      Effect.flatMap(({ status, body }) =>
        status === 200
          ? Schema.decodeUnknownEffect(Health)(body).pipe(Effect.mapError(protocol))
          : Effect.fail(new NimboError({ status, reason: "health check failed" })),
      ),
    ),
  });
};

/** Runs one extraction with the `Nimbo` service from the context. */
export const scrape = (input: ScrapeInput) => Nimbo.use((nimbo) => nimbo.scrape(input));
