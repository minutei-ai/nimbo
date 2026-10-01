import { Effect, Schema, Semaphore } from "effect";
import wasm from "nimbo:wasm";
import {
  initSync,
  WasmPage,
  engine_limits,
  engine_version,
} from "../../../dist/wasm/nimbo_engine.js";
import { Action, Input, Limits, ScrapeError, failure, type Environment } from "./protocol";
import { Transport, readBody } from "./transport";

initSync({ module: wasm });
const limits = Schema.decodeUnknownSync(Limits)(JSON.parse(engine_limits()));
// Single active page bounds the isolate's combined Rust DOM and QuickJS allocations.
const capacity = Semaphore.makeUnsafe(1);

const scrape = (request: Request, environment: Environment) =>
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
      const input = yield* Effect.tryPromise({
        try: () => readBody(request, 128 * 1024),
        catch: (cause) => failure(cause, 400),
      }).pipe(
        Effect.flatMap(({ text }) =>
          Schema.decodeEffect(Schema.fromJsonString(Input))(text).pipe(
            Effect.mapError((cause) => failure(cause, 400)),
          ),
        ),
      );
      const transport = yield* Effect.try({
        try: () => new Transport(input.url, limits, environment.EGRESS),
        catch: (cause) => failure(cause, 400),
      });
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
      const page = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new WasmPage(response.body, response.url),
          catch: (cause) => failure(cause),
        }),
        (loaded) => Effect.sync(() => loaded.free()),
      );
      let evaluating = false;
      while (true) {
        const action = yield* Effect.try({
          try: () => page.step(),
          catch: (cause) => failure(cause),
        }).pipe(
          Effect.flatMap((raw) =>
            Schema.decodeEffect(Schema.fromJsonString(Action))(raw).pipe(
              Effect.mapError((cause) => failure(cause, 500)),
            ),
          ),
        );
        switch (action.type) {
          case "request": {
            yield* Effect.tryPromise({
              try: (signal) => transport.request(action.url, action.method, action.body, signal),
              catch: (cause) => failure(cause, 502),
            }).pipe(
              Effect.flatMap((result) =>
                Effect.try({
                  try: () => page.respond(JSON.stringify(result)),
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
            break;
          }
          case "ready":
            if (evaluating)
              return yield* new ScrapeError({ status: 500, reason: "missing evaluation result" });
            yield* Effect.try({
              try: () => page.evaluate(input.expression),
              catch: (cause) => failure(cause),
            });
            evaluating = true;
            break;
          case "result": {
            const value: unknown = yield* Effect.try({
              try: (): unknown => JSON.parse(action.json),
              catch: (cause) => failure(cause, 500),
            });
            return Response.json({ url: response.url, value, engine: "rust-wasm-quickjs" });
          }
        }
      }
    }),
  ).pipe(Effect.timeout(limits.timeoutMs));

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health")
      return Response.json({ engine: "rust-wasm-quickjs", version: engine_version() });
    if (request.method !== "POST" || path !== "/scrape")
      return new Response("Not found", { status: 404 });
    if (!environment.API_TOKEN) return new Response("API token is not configured", { status: 503 });
    if (request.headers.get("authorization") !== `Bearer ${environment.API_TOKEN}`)
      return new Response("Unauthorized", { status: 401 });
    return Effect.runPromise(
      scrape(request, environment).pipe(
        Effect.catch((cause) => {
          const error =
            cause instanceof ScrapeError
              ? cause
              : new ScrapeError({ status: 504, reason: "scrape deadline or invalid input" });
          return Effect.succeed(Response.json({ error: error.reason }, { status: error.status }));
        }),
      ),
    );
  },
};
