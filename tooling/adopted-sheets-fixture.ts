import { join } from "node:path";
export async function adoptedSheetsFixture(path: string): Promise<Response | undefined> {
  if (!path.startsWith("/adopted-sheets/")) return undefined;
  const source = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/adopted-sheets.txt"),
  ).text();
  return new Response(
    `<!doctype html><style>html,body {margin:0;padding:0} #target {width:3px;height:2px;color:rgb(1,2,3)}</style><div id=target></div><script>${source}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
