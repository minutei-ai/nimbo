const program = await Bun.file(
  new URL("../crates/engine/tests/fixtures/promise-evaluation.txt", import.meta.url),
).text();

export function promiseEvaluationFixture(path: string): Response | undefined {
  const match = path.match(/^\/promise-evaluation\/(global|then)\/\d+$/u);
  if (!match) return undefined;
  return new Response(
    `<!doctype html><body><script>globalThis.promisePatchMode=${JSON.stringify(match[1])};${program}</script>`,
    {
      headers: { "content-type": "text/html" },
    },
  );
}
