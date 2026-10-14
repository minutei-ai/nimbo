import { expect, test } from "bun:test";
import { classifyChecks } from "./compare-css-contracts";

test("comparison profiles preserve candidate failures and exact reference divergences", () => {
  const divergence = { order: "Declared standards discrepancy" };
  expect(classifyChecks({ order: true, identity: true }, 2)).toBe("passed");
  expect(classifyChecks({ order: false, identity: true }, 2)).toBe("failed");
  expect(classifyChecks({ order: false, identity: true }, 2, divergence)).toBe(
    "reference-divergence",
  );
  expect(classifyChecks({ order: false, identity: false }, 2, divergence)).toBe("failed");
  expect(classifyChecks({ order: true, identity: true }, 2, divergence)).toBe("failed");
  expect(classifyChecks({ identity: true, replacement: true }, 2, divergence)).toBe("failed");
  expect(classifyChecks({ order: false }, 2, divergence)).toBe("failed");
});
