import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Exit, Option, Schema, Semaphore } from "effect";
import wasm from "nimbo:wasm";
import {
  initSync,
  WasmPageLoader,
  engine_limits,
  engine_version,
} from "../../../dist/wasm/nimbo_engine.js";
import {
  Action,
  Input,
  Limits,
  ScrapeError,
  completionFailure,
  failure,
  type Environment,
} from "./protocol";
import { Transport, readBody } from "./transport";

const { memory } = initSync({ module: wasm });
const configuration: unknown = JSON.parse(engine_limits());
const limits = Schema.decodeUnknownSync(Limits)(configuration);
const defaults = Schema.decodeUnknownSync(Schema.Struct({ page: Schema.Unknown }))(
  configuration,
).page;
// Single active page bounds the isolate's combined Rust DOM and QuickJS allocations.
const capacity = Semaphore.makeUnsafe(1);

type FailureState = {
  phase:
    | "admission"
    | "input"
    | "navigation"
    | "parsing"
    | "initialization"
    | "execution"
    | "resource"
    | "readiness"
    | "extraction"
    | "serialization";
  diagnostics: boolean;
  enginePhase?: string;
};

type ScrapeInput = typeof Input.Type;

/** Outcome shared by the HTTP route and the RPC entrypoint: an HTTP status and JSON body. */
export interface Outcome {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const scrape = (
  source: Effect.Effect<ScrapeInput, ScrapeError>,
  environment: Environment,
  state: FailureState,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        capacity
          .takeIfAvailable(1)
          .pipe(
            Effect.flatMap((available) =>
              available
                ? Effect.void
                : Effect.fail(new ScrapeError({ status: 429, reason: "isolate capacity reached" })),
            ),
          ),
        () => capacity.release(1),
      );
      state.phase = "input";
      const input = yield* source;
      state.diagnostics = input.diagnostics === true;
      const wasmLinearBytesBefore =
        input.diagnostics === true ? memory.buffer.byteLength : undefined;
      state.phase = "navigation";
      const transport = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new Transport(input.url, limits, environment.EGRESS, environment.PROXY_URL),
          catch: (cause) => failure(cause, 400),
        }),
        (connection) => Effect.sync(() => connection.free()),
      );
      const response = yield* Effect.tryPromise({
        try: (signal) => transport.request(input.url, "GET", "", signal),
        catch: (cause) => failure(cause, 502),
      });
      if (response.status < 200 || response.status >= 300)
        return yield* new ScrapeError({
          status: 502,
          reason: `navigation HTTP ${response.status}`,
        });
      if (!response.content_type.toLowerCase().startsWith("text/html"))
        return yield* new ScrapeError({ status: 422, reason: "navigation requires text/html" });
      state.phase = "parsing";
      const loader = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            new WasmPageLoader(
              response.url,
              input.scripts !== "skip",
              input.media === undefined ? undefined : JSON.stringify(input.media),
              input.maxStylesheetBytes,
              input.maxLayoutNodes,
              transport.cookies.share(),
              input.maxDomOperations,
              input.maxInitialDomNodes,
              input.maxDomNodes,
            ),
          catch: (cause) => failure(cause),
        }),
        (loaded) => Effect.sync(() => loaded.free()),
      );
      const encoder = new TextEncoder();
      const bytes = new Uint8Array(8192);
      let offset = 0;
      let blocks = 0;
      while (offset < response.body.length) {
        let end = Math.min(offset + 8192, response.body.length);
        const last = response.body.charCodeAt(end - 1);
        // Keep a trailing high surrogate with its following code unit.
        if (end < response.body.length && last >= 0xd800 && last <= 0xdbff) end--;
        const { read, written } = encoder.encodeInto(response.body.slice(offset, end), bytes);
        const deep = yield* Effect.try({
          try: () => loader.feed(bytes.subarray(0, written)),
          catch: (cause) => failure(cause),
        });
        offset += read;
        blocks++;
        // Deep trees yield every block; shallow input yields after at most 128 KiB.
        if (deep || blocks % 16 === 0 || (offset === response.body.length && blocks > 1))
          yield* Effect.yieldNow;
      }
      // Parsing owns its data now; do not retain the navigation string during scripts or waits.
      response.body = "";
      state.phase = "initialization";
      const page = yield* Effect.acquireRelease(
        Effect.try({
          try: () => loader.finish(),
          catch: (cause) => failure(cause),
        }),
        (loaded) =>
          Effect.sync(() => {
            // Capture state before disposal, including interrupted scopes. Always free the page.
            try {
              if (state.diagnostics) state.enginePhase = loaded.execution_phase();
            } finally {
              loaded.free();
            }
          }),
      );
      let evaluating = false;
      let waiting = false;
      const epoch = performance.now();
      state.phase = "execution";
      while (true) {
        const action = yield* Effect.try({
          try: () => {
            page.advance(performance.now() - epoch);
            return page.step();
          },
          catch: (cause) => failure(cause),
        }).pipe(
          Effect.flatMap((raw) =>
            Schema.decodeEffect(Schema.fromJsonString(Action))(raw).pipe(
              Effect.mapError((cause) => failure(cause, 500)),
            ),
          ),
        );
        switch (action.type) {
          case "wait":
            yield* Effect.sleep(action.milliseconds);
            break;
          case "request": {
            const resume: FailureState["phase"] = state.phase;
            state.phase = "resource";
            yield* Effect.tryPromise({
              try: (signal) =>
                transport.request(action.url, action.method, action.body, signal, action.binary),
              catch: (cause) => failure(cause, 502),
            }).pipe(
              Effect.flatMap((result) =>
                Effect.try({
                  try: () => {
                    const { raw_body, ...metadata } = result;
                    if (raw_body === undefined) page.respond(JSON.stringify(metadata));
                    else page.respond_binary(JSON.stringify(metadata), raw_body);
                  },
                  catch: (cause) => failure(cause),
                }),
              ),
              Effect.catchIf(
                (error) => error.status === 502,
                (error) =>
                  Effect.try({
                    try: () => page.reject(error.reason),
                    catch: (cause) => failure(cause),
                  }),
              ),
            );
            state.phase = resume;
            break;
          }
          case "ready":
            if (evaluating)
              return yield* new ScrapeError({ status: 500, reason: "missing evaluation result" });
            if (input.waitFor !== undefined && !waiting) {
              state.phase = "readiness";
              yield* Effect.try({
                try: () => page.wait_for(JSON.stringify(input.waitFor)),
                catch: (cause) => failure(cause),
              });
              waiting = true;
              break;
            }
            state.phase = "extraction";
            yield* Effect.try({
              try: () => page.evaluate(input.expression),
              catch: (cause) => failure(cause),
            });
            evaluating = true;
            break;
          case "result": {
            state.phase = "serialization";
            const value: unknown = yield* Effect.try({
              try: (): unknown => JSON.parse(action.json),
              catch: (cause) => failure(cause, 500),
            });
            const diagnostics =
              input.diagnostics === true
                ? yield* Effect.try({
                    try: () => page.diagnostics(),
                    catch: (cause) => failure(cause, 500),
                  }).pipe(
                    Effect.flatMap(
                      Schema.decodeEffect(
                        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Finite)),
                      ),
                    ),
                    Effect.mapError((cause) => failure(cause, 500)),
                  )
                : undefined;
            return {
              url: response.url,
              value,
              engine: "rust-wasm-quickjs",
              ...(diagnostics === undefined
                ? {}
                : {
                    diagnostics: {
                      ...diagnostics,
                      wasmLinearBytesBefore,
                      wasmLinearBytes: memory.buffer.byteLength,
                    },
                  }),
            };
          }
        }
      }
    }),
  ).pipe(Effect.timeout(limits.timeoutMs));

const execute = async (
  read: Effect.Effect<ScrapeInput, ScrapeError>,
  environment: Environment,
  signal?: AbortSignal,
): Promise<Outcome> => {
  const state: FailureState = { phase: "admission", diagnostics: false };
  const exit = await Effect.runPromiseExit(
    scrape(read, environment, state),
    signal === undefined ? undefined : { signal },
  );
  if (Exit.isSuccess(exit)) return { status: 200, body: exit.value };
  const cancelled = Exit.hasInterrupts(exit);
  const cause = Option.getOrUndefined(Exit.findErrorOption(exit));
  const error = completionFailure(cause, cancelled);
  const diagnostics = state.diagnostics
    ? {
        phase: state.phase,
        ...(state.enginePhase === undefined ? {} : { enginePhase: state.enginePhase }),
        cancelled,
      }
    : undefined;
  if (cancelled && diagnostics !== undefined)
    console.info(JSON.stringify({ event: "nimbo.scrape.cancelled", diagnostics }));
  return {
    status: error.status,
    body: { error: error.reason, ...(diagnostics === undefined ? {} : { diagnostics }) },
  };
};

const health = () => ({ engine: "rust-wasm-quickjs", version: engine_version(), limits: defaults });

const readHttp = (request: Request) =>
  Effect.tryPromise({
    try: () => readBody(request, 128 * 1024),
    catch: (cause) => failure(cause, 400),
  }).pipe(
    Effect.flatMap(({ text }) =>
      Schema.decodeEffect(Schema.fromJsonString(Input))(text).pipe(
        Effect.mapError((cause) => failure(cause, 400)),
      ),
    ),
  );

/**
 * Native RPC entrypoint for Cloudflare service bindings. A binding is
 * authorized by deployment configuration, so it carries no API token; it
 * shares admission, limits and failures with `POST /scrape`.
 */
export class Engine extends WorkerEntrypoint<Environment> {
  scrape(input: unknown): Promise<Outcome> {
    return execute(
      Schema.decodeUnknownEffect(Input)(input).pipe(
        Effect.mapError((cause) => failure(cause, 400)),
      ),
      this.env,
    );
  }
  health() {
    return health();
  }
}

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") return Response.json(health());
    if (request.method !== "POST" || path !== "/scrape")
      return new Response("Not found", { status: 404 });
    if (!environment.API_TOKEN) return new Response("API token is not configured", { status: 503 });
    if (request.headers.get("authorization") !== `Bearer ${environment.API_TOKEN}`)
      return new Response("Unauthorized", { status: 401 });
    const outcome = await execute(readHttp(request), environment, request.signal);
    return Response.json(outcome.body, { status: outcome.status });
  },
};
