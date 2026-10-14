/** The `Engine` RPC entrypoint as seen through a Cloudflare service binding. */
export interface EngineBinding {
  scrape(input: unknown): Promise<unknown>;
  health(): Promise<unknown>;
}
