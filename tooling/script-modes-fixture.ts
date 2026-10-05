const fixture = (name: string) =>
  Bun.file(new URL(`../crates/engine/tests/fixtures/${name}`, import.meta.url)).text();
const [source, template, moduleSource, expression] = await Promise.all([
  fixture("script-modes.txt"),
  fixture("script-modes-html.txt"),
  fixture("script-modes-module.txt"),
  fixture("script-modes-expression.txt"),
]);
export const scriptModesExpression = expression;
export function scriptModesFixture(path: string): Response | undefined {
  if (path === "/script-modes-assets/classic.js")
    return new Response(
      "externalCreated=modeVariant+1;globalThis.externalReceiver=(function(){return this})();",
      { headers: { "content-type": "text/javascript" } },
    );
  if (path === "/script-modes-assets/module.mjs")
    return new Response(moduleSource, { headers: { "content-type": "text/javascript" } });
  if (!path.startsWith("/script-modes/")) return undefined;
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  return new Response(
    template.replace("__VARIANT__", String(variant)).replace("__CASE_SOURCE__", source),
    { headers: { "content-type": "text/html" } },
  );
}
