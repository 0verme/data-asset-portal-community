import assert from "node:assert/strict";
import test from "node:test";
import { readinessPercentage, type ModuleReadinessResult } from "./moduleReadiness.ts";

const result: ModuleReadinessResult = {
  moduleId: "test", metricId: "fixture", definition: "Test population",
  numerator: 1, denominator: 3, percentage: 33.3, updatedAt: null, status: "ready",
};

test("readiness uses the supplied result, including a measured zero", () => {
  assert.equal(readinessPercentage(result), 33.3);
  assert.equal(readinessPercentage({ ...result, numerator: 0, percentage: 0 }), 0);
});

test("missing definition, invalid counts, missing percentage and non-ready states have no value", () => {
  const invalid: Partial<ModuleReadinessResult>[] = [
    { metricId: null }, { definition: " " }, { denominator: null }, { denominator: 0 },
    { numerator: -1 }, { numerator: 4 }, { numerator: null }, { denominator: Infinity },
    { percentage: null }, { percentage: NaN }, { percentage: 101 },
    { status: "pending_definition" }, { status: "loading" }, { status: "unavailable" }, { status: "not_applicable" },
  ];
  for (const patch of invalid) assert.equal(readinessPercentage({ ...result, ...patch }), null);
});
