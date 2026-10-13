export type Measurements = {
  readonly samples_ms: readonly number[];
  readonly rss_kib: readonly number[];
};

// Nearest rank: p95 includes the maximum for fewer than 20 samples.
export function percentile(values: readonly number[], quantile: number): number {
  if (
    values.length === 0 ||
    !Number.isFinite(quantile) ||
    quantile <= 0 ||
    quantile > 1 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Invalid benchmark samples or quantile");
  const sorted = values.toSorted((left, right) => left - right);
  const value = sorted[Math.ceil(sorted.length * quantile) - 1];
  if (value === undefined) throw new Error("Missing percentile");
  return value;
}

export function summarize(measurements: Measurements) {
  const seconds = measurements.samples_ms.reduce((total, value) => total + value, 0) / 1000;
  return {
    p50_ms: percentile(measurements.samples_ms, 0.5),
    p95_ms: percentile(measurements.samples_ms, 0.95),
    min_ms: percentile(measurements.samples_ms, Number.MIN_VALUE),
    max_ms: percentile(measurements.samples_ms, 1),
    sequential_extractions_per_second:
      seconds > 0 ? measurements.samples_ms.length / seconds : null,
    max_rss_kib: measurements.rss_kib.length ? percentile(measurements.rss_kib, 1) : null,
  };
}

// Predeclared tolerances, never tuned by the measured candidate. Timing gates belong
// on an idle controlled runner; correctness gates also run on shared CI.
export const regressionPolicy = {
  p50: { relative: 0.15, absolute: 5 },
  p95: { relative: 0.2, absolute: 5 },
  rss: { relative: 0.2, absolute: 16384 },
} as const;

export function regressions(baseline: Measurements, candidate: Measurements): string[] {
  const before = summarize(baseline),
    after = summarize(candidate);
  const comparisons = [
    ["p50_ms", before.p50_ms, after.p50_ms, regressionPolicy.p50],
    ["p95_ms", before.p95_ms, after.p95_ms, regressionPolicy.p95],
    ["max_rss_kib", before.max_rss_kib, after.max_rss_kib, regressionPolicy.rss],
  ] as const;
  return comparisons.flatMap(([metric, previous, current, tolerance]) => {
    if (previous === null || current === null) return [];
    return current - previous > Math.max(previous * tolerance.relative, tolerance.absolute)
      ? [metric]
      : [];
  });
}
