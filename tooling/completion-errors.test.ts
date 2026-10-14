import { expect, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import { completionFailure, ScrapeError } from "../apps/worker/src/protocol";

test("owned execution errors preserve their HTTP status and reason", () => {
  const error = new ScrapeError({ status: 422, reason: "resource limit: readiness deadline" });
  expect(completionFailure(error, false)).toBe(error);
});

test("Effect host timeout retains deadline status", async () => {
  const exit = await Effect.runPromiseExit(Effect.never.pipe(Effect.timeout(1)));
  expect(completionFailure(Option.getOrUndefined(Exit.findErrorOption(exit)), false)).toMatchObject(
    {
      status: 504,
      reason: "scrape deadline or invalid input",
    },
  );
});

test("Effect defects are internal failures with no raw cause exposure", async () => {
  const exit = await Effect.runPromiseExit(Effect.die(new Error("synthetic-private-marker")));
  expect(completionFailure(Option.getOrUndefined(Exit.findErrorOption(exit)), false)).toMatchObject(
    {
      status: 500,
      reason: "scrape execution failed",
    },
  );
});

test("incoming interruption takes precedence over a concurrent execution error", async () => {
  const controller = new AbortController();
  controller.abort();
  const exit = await Effect.runPromiseExit(Effect.never, { signal: controller.signal });
  expect(
    completionFailure(
      new ScrapeError({ status: 422, reason: "synthetic" }),
      Exit.hasInterrupts(exit),
    ),
  ).toMatchObject({
    status: 499,
    reason: "scrape cancelled",
  });
});
