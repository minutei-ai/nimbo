import { join } from "node:path";
const script = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/cookies.txt"),
).text();
export function cookiesFixture(path: string, request: Request): Response | undefined {
  if (/^\/cookies\/\d+$/.test(path)) {
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    headers.append("set-cookie", "sid=alpha; HttpOnly; Path=/");
    headers.append("set-cookie", "boot=visible; Path=/");
    return new Response(`<!doctype html><script>${script}</script>`, { headers });
  }
  if (["/cookies/echo", "/outside/echo", "/cookies-other/echo"].includes(path))
    return Response.json(request.headers.get("cookie") ?? "", {
      headers: { "set-cookie": "fetched=yes; Path=/" },
    });
  return undefined;
}
