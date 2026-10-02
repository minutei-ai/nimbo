import { join } from "node:path";

export async function cssBudgetFixture(path: string): Promise<Response | undefined> {
  if (path.startsWith("/css-budget-assets/")) {
    const variant = Number(path.split("/").at(-1));
    const kind = path.split("/").at(-2);
    let source: string;
    if (kind === "first")
      source = `@media (min-width:1px){/*${"é".repeat(150000)}*/#target{width:${variant + 300}px}@font-face{font-family:BudgetFont${variant};src:url('/font-assets/font/${variant}')}}`;
    else if (kind === "replacement")
      source = `/*${"x".repeat(320000)}*/#target{width:${variant + 400}px}`;
    else source = `/*${"x".repeat(150000)}*/#target{height:${variant + 20}px}`;
    return new Response(source, { headers: { "content-type": "text/css; charset=utf-8" } });
  }
  if (path.startsWith("/css-budget/")) {
    const variant = Number(path.split("/").at(-1));
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/css-budget.txt"),
    ).text();
    return new Response(
      `<!doctype html><meta charset="utf-8"><style id=inline>/*${"x".repeat(120000)}*/#target{width:10px;height:15px}</style><link id=first rel=stylesheet href='/css-budget-assets/first/${variant}'><link id=second rel=stylesheet href='/css-budget-assets/second/${variant}'><div id=target></div><script>${script}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  return undefined;
}
