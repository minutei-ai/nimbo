import { benchmarkFixture, benchmarkScenarios, comparisonScenarios } from "./benchmark-fixture";
import { hotPathFixture, hotPathScenarios } from "./hot-paths-fixture";

// Change this version whenever a workload, expected result or resource budget changes.
export const corpusVersion = 1;
export const extractionCorpus = [
  ...benchmarkScenarios,
  ...comparisonScenarios.filter((scenario) => scenario.name.endsWith("5000")),
  ...hotPathScenarios.map((scenario) => ({
    name: scenario.name,
    path: `/${scenario.name}`,
    expression: scenario.expression,
    expected: true,
  })),
  {
    name: "text-wrap",
    path: "/text-wrap",
    expression:
      "(()=>{const nodes=document.querySelectorAll('p');return nodes.length===64&&Array.from(nodes).every(e=>{const r=e.getBoundingClientRect();return r.width===240&&r.height>20&&Number.isFinite(r.height)})})()",
    expected: true,
  },
] as const;

export function extractionFixture(request: Request): Response {
  const path = new URL(request.url).pathname;
  if (path === "/text-wrap")
    return new Response(
      `<!doctype html><style>p{width:240px;font:16px/20px sans-serif;overflow-wrap:anywhere}</style>${"<p>Deterministic extraction measures repeated paragraph wrapping and geometry.</p>".repeat(64)}`,
      { headers: { "content-type": "text/html", "cache-control": "no-store" } },
    );
  return hotPathFixture(path) ?? benchmarkFixture(request);
}
