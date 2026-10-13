import { expect, test } from "bun:test";
import { percentile, regressions, summarize } from "./benchmark-statistics";

test("nearest-rank quantiles include the tail in small samples", () => {
  expect(percentile([3, 1, 2], 0.5)).toBe(2);
  expect(
    percentile(
      Array.from({ length: 15 }, (_, index) => index + 1),
      0.95,
    ),
  ).toBe(15);
  expect(percentile([7], 1)).toBe(7);
});

test("invalid samples cannot produce a valid performance report", () => {
  for (const values of [[], [Number.NaN], [Infinity], [-1]])
    expect(() => percentile(values, 0.5)).toThrow();
  for (const quantile of [0, -1, 2, Number.NaN]) expect(() => percentile([1], quantile)).toThrow();
});

test("sequential throughput derives from measured time, and missing RSS stays unknown", () => {
  expect(summarize({ samples_ms: [10, 30], rss_kib: [] })).toEqual({
    p50_ms: 10,
    p95_ms: 30,
    min_ms: 10,
    max_ms: 30,
    sequential_extractions_per_second: 50,
    max_rss_kib: null,
  });
});

test("fixed relative and absolute regression thresholds reject slow and large candidates", () => {
  const before = { samples_ms: [100, 100, 100], rss_kib: [100000] };
  expect(regressions(before, { samples_ms: [130, 130, 130], rss_kib: [130000] })).toEqual([
    "p50_ms",
    "p95_ms",
    "max_rss_kib",
  ]);
  expect(regressions(before, { samples_ms: [110, 110, 110], rss_kib: [110000] })).toEqual([]);
  expect(
    regressions({ samples_ms: [1], rss_kib: [1000] }, { samples_ms: [5], rss_kib: [16000] }),
  ).toEqual([]);
  expect(regressions(before, { samples_ms: [100], rss_kib: [] })).toEqual([]);
});
