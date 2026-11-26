import assert from "node:assert/strict";
import test from "node:test";
import { getMockModuleReadiness } from "../../../api/moduleReadiness.ts";
import { deleteRoot, saveRoot } from "../../../api/root.ts";
import {
  buildModuleReadinessResult,
  getModuleReadinessSkeleton,
  getModuleReadinessSpec,
  MODULE_READINESS_SPECS,
  readinessPercentage,
  type ModuleReadinessResult,
  type ReadinessModuleId,
} from "./moduleReadiness.ts";

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
    { status: "pending_definition" }, { status: "pending_integration" }, { status: "loading" }, { status: "unavailable" }, { status: "not_applicable" },
  ];
  for (const patch of invalid) assert.equal(readinessPercentage({ ...result, ...patch }), null);
});

test("module readiness specs configure primary-table definitions for asset modules and mark system not_applicable", () => {
  const assetModules: ReadinessModuleId[] = [
    "data-warehouse",
    "mapping",
    "root",
    "indicator",
    "codeTable",
    "report",
    "apiAsset",
    "push",
    "lineage",
  ];

  assert.equal(getModuleReadinessSpec("dwm").moduleId, "data-warehouse");
  assert.equal(getModuleReadinessSkeleton("dwm").metricId, "table_readiness");

  for (const moduleId of assetModules) {
    const spec = MODULE_READINESS_SPECS[moduleId];
    const skeleton = getModuleReadinessSkeleton(moduleId);
    assert.equal(spec.defaultStatus, "pending_integration");
    assert.ok(spec.metricId && spec.metricId.length > 0);
    assert.ok(spec.primaryTable && spec.primaryTable.startsWith("p_"));
    assert.ok(spec.definition && spec.definition.startsWith("计入："));
    assert.equal(skeleton.status, "pending_integration");
    assert.equal(skeleton.metricId, spec.metricId);
    assert.equal(skeleton.definition, spec.definition);
    assert.equal(readinessPercentage(skeleton), null);

    const ready = getModuleReadinessSkeleton(moduleId, {
      status: "ready",
      numerator: 7,
      denominator: 10,
      percentage: 70,
    });
    assert.equal(readinessPercentage(ready), 70);
  }

  assert.equal(MODULE_READINESS_SPECS.codeTable.primaryTable, "p_manual_code_table");
  assert.equal(MODULE_READINESS_SPECS.push.primaryTable, "p_push_job");
  assert.equal(MODULE_READINESS_SPECS.push.metricId, "push_job_readiness");

  const systemSkeleton = getModuleReadinessSkeleton("system");
  assert.equal(systemSkeleton.moduleId, "system");
  assert.equal(systemSkeleton.status, "not_applicable");
  assert.equal(systemSkeleton.metricId, null);
  assert.equal(systemSkeleton.definition, null);
  assert.equal(readinessPercentage(systemSkeleton), null);
});

test("buildModuleReadinessResult and mock readiness compute live primary-table readiness across all modules", async () => {
  const zero = buildModuleReadinessResult("root", { numerator: 0, denominator: 0 });
  assert.equal(zero.status, "unavailable");
  assert.equal(readinessPercentage(zero), null);

  for (const moduleId of [
    "data-warehouse",
    "mapping",
    "indicator",
    "codeTable",
    "report",
    "apiAsset",
    "push",
    "lineage",
  ] as const) {
    const live = getMockModuleReadiness(moduleId);
    assert.equal(live.status, "ready", `${moduleId} should be ready`);
    assert.ok(live.denominator !== null && live.denominator > 0);
    assert.ok(live.numerator !== null && live.numerator >= 0 && live.numerator <= live.denominator);
    assert.ok(readinessPercentage(live) !== null);
  }

  assert.equal(getMockModuleReadiness("codeTable").denominator, 7);
  assert.equal(getMockModuleReadiness("codeTable").numerator, 7);
  assert.equal(getMockModuleReadiness("push").denominator, 5);
  assert.equal(getMockModuleReadiness("push").numerator, 5);
  assert.equal(getMockModuleReadiness("system").status, "not_applicable");

  // Root mock store starts empty (unavailable) and becomes ready when roots are added.
  assert.equal(getMockModuleReadiness("root").status, "unavailable");
  await saveRoot({
    abbr: "readinessfixture",
    en: "Readiness Fixture",
    cn: "就绪度测试词根",
    cat: "业务对象",
    desc: "用于测试词根就绪度的完整释义",
    example: "readiness_fixture_id",
  });
  try {
    const rootReady = getMockModuleReadiness("root");
    assert.equal(rootReady.status, "ready");
    assert.equal(rootReady.numerator, 1);
    assert.equal(rootReady.denominator, 1);
    assert.equal(readinessPercentage(rootReady), 100);
  } finally {
    await deleteRoot("readinessfixture");
  }
});
