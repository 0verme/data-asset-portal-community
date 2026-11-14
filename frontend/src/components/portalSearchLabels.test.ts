import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePortalScopeLabel,
  resolvePortalStatLabel,
  resolveSearchGroupLabel,
} from "./portalSearchLabels.ts";

const translate = (key: string) => `translated:${key}`;

test("portal scope and group labels map only known default names at render time", () => {
  assert.equal(resolvePortalScopeLabel({ key: "asset", label: "资产" }, translate), "translated:scopes.asset");
  assert.equal(resolvePortalScopeLabel({ key: "asset", label: "自定义资产" }, translate), "自定义资产");
  assert.equal(resolvePortalScopeLabel({ key: "custom", label: "自定义范围" }, translate), "自定义范围");

  assert.equal(resolveSearchGroupLabel({ type: "field", label: "字段" }, translate), "translated:groups.field");
  assert.equal(resolveSearchGroupLabel({ type: "field", label: "自定义字段组" }, translate), "自定义字段组");
  assert.equal(resolveSearchGroupLabel({ type: "unknown", label: "未知分类" }, translate), "未知分类");
});

test("portal statistic translation leaves unknown labels untouched", () => {
  assert.equal(resolvePortalStatLabel("源系统", translate), "translated:stats.sourceSystems");
  assert.equal(resolvePortalStatLabel("API", translate), "translated:stats.apis");
  assert.equal(resolvePortalStatLabel("租户定义统计", translate), "租户定义统计");
});
