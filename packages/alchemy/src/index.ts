import type { Rpc } from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import type { EngineBinding } from "@nimbo/client/binding";

/** Type of the engine's `Engine` entrypoint, for typed service bindings. */
export type EngineEntrypoint = Rpc.WorkerEntrypointBranded & EngineBinding;

type Secret = Cloudflare.WorkerBindingResource;

export interface EngineOptions {
  /** Path of the built Worker bundle (`dist/worker/index.js`). */
  readonly main: string;
  /** Compatibility date the bundle was validated with. */
  readonly compatibilityDate?: string;
  /** Enables `POST /scrape` over HTTP. Omit it for a binding-only engine. */
  readonly apiToken?: Secret;
  /** Generic HTTP/CONNECT proxy for page egress, from private configuration. */
  readonly proxyUrl?: Secret;
}

/**
 * Deploys the engine Worker from the caller's stack. Load `apiToken` and
 * `proxyUrl` with `Config.Redacted` in that stack, never from source.
 */
export const Engine = (id: string, options: EngineOptions) =>
  Cloudflare.Worker(id, {
    main: options.main,
    bundle: false,
    compatibility: {
      date: options.compatibilityDate ?? "2026-07-30",
      flags: ["enable_request_signal"],
    },
    env: {
      ...(options.apiToken === undefined ? {} : { API_TOKEN: options.apiToken }),
      ...(options.proxyUrl === undefined ? {} : { PROXY_URL: options.proxyUrl }),
    },
  });

/**
 * A service binding to the engine's RPC entrypoint, for a caller Worker's
 * `env`. Pass the runtime binding to `layerBinding`.
 */
export const binding = (engine: Cloudflare.Worker) =>
  Cloudflare.WorkerEntrypoint<EngineEntrypoint>(engine, "Engine");
