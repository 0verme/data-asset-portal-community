import assert from "node:assert/strict";
import test from "node:test";

import { API_ASSETS } from "./data/apiAssets.js";
import { FIELD_MAPPING_ROWS } from "./data/fieldMappings.js";
import { INDICATORS } from "./data/indicators.js";
import { PUSH_SYSTEMS } from "./data/pushSystems.js";
import { REPORTS } from "./data/reports.js";
import { WORD_ROOTS } from "./data/roots.js";
import { SYSTEMS } from "./data/systems.js";
import { DWM_TABLES } from "./data/tables.js";
import { UPSTREAM_SYSTEMS } from "./data/upstreamSystems.js";

test("retail demo exposes the planned deterministic data volume", () => {
  assert.equal(SYSTEMS.length, 8);
  assert.equal(DWM_TABLES.length, 32);
  assert.equal(INDICATORS.length, 36);
  assert.equal(FIELD_MAPPING_ROWS.length, 72);
  assert.equal(new Set(FIELD_MAPPING_ROWS.map((item) => `${item.srcSystem}:${item.srcTable}`)).size, 12);
  assert.equal(UPSTREAM_SYSTEMS.length, 8);
  assert.equal(PUSH_SYSTEMS.length, 6);
  assert.equal(REPORTS.length, 8);
  assert.equal(API_ASSETS.length, 10);
  assert.equal(WORD_ROOTS.length, 40);
});

test("retail assets have unique names and complete field metadata", () => {
  assert.equal(new Set(DWM_TABLES.map((item) => item.name)).size, DWM_TABLES.length);
  DWM_TABLES.forEach((table) => {
    assert.ok(["商品", "会员", "交易", "门店", "库存", "营销", "履约", "售后"].includes(table.domain));
    assert.ok(table.fields.length >= 8 && table.fields.length <= 15, `${table.name} field count`);
    assert.ok(table.fields.some((field) => field.pk), `${table.name} primary key`);
    assert.ok(table.fields.some((field) => field.part), `${table.name} partition field`);
    assert.equal(new Set(table.fields.map((field) => field.name)).size, table.fields.length);
  });
});

test("retail indicator, report, api and mapping references resolve", () => {
  const tableFields = new Map(DWM_TABLES.map((table) => [table.name, new Set(table.fields.map((field) => field.name))]));
  INDICATORS.forEach((indicator) => {
    const baseName = indicator.resultTableName.replace(/^dws_/, "dwm_");
    assert.ok(tableFields.has(baseName), `${indicator.id} result table`);
    assert.ok(tableFields.get(baseName).has(indicator.resultFieldName), `${indicator.id} result field`);
  });

  const indicatorIds = new Set(INDICATORS.map((item) => item.id));
  REPORTS.flatMap((report) => report.relatedIndicators).forEach((item) => assert.ok(indicatorIds.has(item.indicatorId)));
  const systemIds = new Set(SYSTEMS.map((item) => item.id));
  API_ASSETS.forEach((item) => assert.ok(systemIds.has(item.systemId)));
  const upstreamNames = new Set(UPSTREAM_SYSTEMS.map((item) => item.name));
  FIELD_MAPPING_ROWS.forEach((item) => assert.ok(upstreamNames.has(item.srcSystem)));
});

test("default runtime demo contains no banking-specific language", () => {
  const text = JSON.stringify({ SYSTEMS, DWM_TABLES, INDICATORS, FIELD_MAPPING_ROWS, UPSTREAM_SYSTEMS, PUSH_SYSTEMS, REPORTS, API_ASSETS, WORD_ROOTS });
  ["银行", "贷款", "存款", "监管", "支行", "反洗钱", "授信", "借据", ".intra", "SFTP"].forEach((term) => assert.doesNotMatch(text, new RegExp(term)));
});
