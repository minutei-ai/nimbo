const directory = new URL("../crates/engine/tests/fixtures/frameworks/", import.meta.url);
const source = (file: string) => Bun.file(new URL(file, directory)).text();
const [app, preact, vue, preactAdapter, vueAdapter, primitives] = await Promise.all([
  source("app.txt"),
  source("preact-10.29.8.txt"),
  source("vue-3.5.22.txt"),
  source("preact-adapter.txt"),
  source("vue-adapter.txt"),
  source("dom-primitives.txt"),
]);
const modules: Readonly<Record<string, string>> = {
  "/frameworks/preact.mjs": preact,
  "/frameworks/vue.mjs": vue,
  "/frameworks/preact/adapter.mjs": preactAdapter,
  "/frameworks/vue/adapter.mjs": vueAdapter,
};
export function frameworkFixture(path: string): Response | undefined {
  const module = modules[path];
  if (module !== undefined)
    return new Response(module, { headers: { "content-type": "text/javascript" } });
  const parts = path.split("/");
  if (parts[1] !== "frameworks") return undefined;
  const framework = parts[2];
  if (framework === "dom-primitives") {
    const variant = Number(parts[3]);
    if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
      return new Response("Not found", { status: 404 });
    return new Response(
      `<!doctype html><body><script>const variant=${variant};${primitives}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (framework === "data")
    return new Response(JSON.stringify({ message: `loaded-${parts[3]}` }), {
      headers: { "content-type": "application/json" },
    });
  const variant = Number(parts[3]);
  if (
    (framework !== "preact" && framework !== "vue") ||
    !Number.isInteger(variant) ||
    variant < 0 ||
    variant >= 64
  )
    return new Response("Not found", { status: 404 });
  // Framework module URLs are scoped to the selected application, keeping each HTTP page independent.
  const scopedApp = app.replaceAll(
    "'/frameworks/adapter.mjs'",
    `'/frameworks/${framework}/adapter.mjs'`,
  );
  return new Response(
    `<!doctype html><div id="app"><main><p id="count">Count: ${variant}</p><button id="increment">Increment</button><ul><li data-key="1">1</li><li data-key="2">2</li><li data-key="3">3</li></ul><p id="message">server</p></main></div><script type="module">const variant=${variant};${scopedApp}</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
