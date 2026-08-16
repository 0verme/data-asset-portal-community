// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { requestRemote } from "./http.js";
import { LONG_REQUEST_TIMEOUT } from "../config/request.js";
import { FIELD_MAPPING_ROWS } from "../data/fieldMappings.js";
import { UPSTREAM_SYSTEMS } from "../data/upstreamSystems.js";

const API_MODE = import.meta.env.VITE_API_MODE || "mock";
export const FIELD_MAPPING_PAGE_SIZE_OPTIONS = [50, 100, 150];
export const FIELD_MAPPING_DEFAULT_PAGE_SIZE = FIELD_MAPPING_PAGE_SIZE_OPTIONS[0];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.data && typeof payload.data === "object" ? payload.data : payload;
  }
  throw new Error("字段映射接口返回格式无效");
}

function normalizePaged(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("字段映射分页接口返回格式无效");
  }
  return {
    items: normalizeCollection(payload, "fields"),
    total: Number(payload.total || 0),
    page: Number(payload.page || 1),
    pageSize: Number(payload.pageSize || 0),
  };
}

function includesValue(value, query) {
  return String(value || "").toLowerCase().includes(query);
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function compareNullableText(left, right) {
  const leftText = String(left || "").trim();
  const rightText = String(right || "").trim();
  const leftEmpty = leftText === "";
  const rightEmpty = rightText === "";

  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  return leftText.localeCompare(rightText, "zh-CN");
}

function compareNullableNumber(left, right) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";

  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  return Number(left) - Number(right);
}

function compareByOrder(left, right, resolvers) {
  for (const resolver of resolvers) {
    const result = resolver(left, right);
    if (result !== 0) return result;
  }
  return 0;
}

function compareFieldRowsDefault(left, right) {
  return compareByOrder(left, right, [
    (a, b) => compareNullableText(a.srcSystem, b.srcSystem),
    (a, b) => compareNullableText(a.srcTable, b.srcTable),
    (a, b) => compareNullableNumber(a.fieldOrder, b.fieldOrder),
    (a, b) => compareNullableText(a.srcField, b.srcField),
    (a, b) => compareNullableText(a.targetTable, b.targetTable),
    (a, b) => compareNullableText(a.targetField, b.targetField),
    (a, b) => compareNullableNumber(a.__mockIndex, b.__mockIndex),
  ]);
}

function compareTableRowsDefault(left, right) {
  return compareByOrder(left, right, [
    (a, b) => compareNullableText(a.srcSystem, b.srcSystem),
    (a, b) => compareNullableText(a.srcTable, b.srcTable),
    (a, b) => compareNullableText(a.targetTable, b.targetTable),
    (a, b) => compareNullableNumber(a.__mockIndex, b.__mockIndex),
  ]);
}

function compareFieldRowsBySort(left, right, sortKey, sortDirection) {
  const direction = sortDirection === "desc" ? -1 : 1;
  const primary = compareNullableText(left[sortKey], right[sortKey]) * direction;
  if (primary !== 0) return primary;
  return compareFieldRowsDefault(left, right);
}

function resolveMockUpstreamSystemId(row) {
  const upstreamMatch = UPSTREAM_SYSTEMS.find((item) => normalizeValue(item.name) === normalizeValue(row.srcSystem));
  return upstreamMatch?.upstreamSystemId ?? "";
}

function enrichRow(row) {
  return {
    ...row,
    fieldOrder: row.fieldOrder ?? row.columnId ?? row.ordinalPosition ?? row.sortOrder ?? null,
    upstreamSystemId: row.upstreamSystemId ?? resolveMockUpstreamSystemId(row),
  };
}

function applyFilters(rows, params = {}) {
  const keyword = String(params.keyword || "").trim().toLowerCase();
  const upstreamSystemId = String(params.upstreamSystemId || "").trim();
  const srcSystem = String(params.srcSystem || "").trim();
  const srcTable = String(params.srcTable || "").trim().toLowerCase();
  const srcField = String(params.srcField || "").trim().toLowerCase();
  const emptyComment = String(params.emptyComment || "").trim();
  const targetTable = String(params.targetTable || "").trim().toLowerCase();
  const targetField = String(params.targetField || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (upstreamSystemId && String(row.upstreamSystemId || "") !== upstreamSystemId) return false;
    if (srcSystem && row.srcSystem !== srcSystem) return false;
    if (srcTable && !includesValue(row.srcTable, srcTable)) return false;
    if (srcField && !includesValue(row.srcField, srcField)) return false;
    if (targetTable && !includesValue(row.targetTable, targetTable)) return false;
    if (targetField && !includesValue(row.targetField, targetField)) return false;
    if (emptyComment === "yes" && String(row.srcComment || "").trim()) return false;
    if (emptyComment === "no" && !String(row.srcComment || "").trim()) return false;
    if (!keyword) return true;
    return [
      row.srcSystem,
      row.srcTable,
      row.srcTableCn,
      row.srcField,
      row.srcType,
      row.srcComment,
      row.targetTable,
      row.targetField,
      row.mappingRule,
    ].some((value) => includesValue(value, keyword));
  });
}

function summarizeTables(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = `${row.srcSystem}::${row.srcTable}`;
    const current = groups.get(key) || {
      __mockIndex: row.__mockIndex ?? 0,
      upstreamSystemId: row.upstreamSystemId || "",
      srcSystem: row.srcSystem,
      srcTable: row.srcTable,
      srcTableCn: row.srcTableCn,
      targetLayer: row.targetLayer,
      targetTable: row.targetTable,
      loadMode: row.loadMode || "",
      fieldCount: 0,
      mappedCount: 0,
      emptyCommentCount: 0,
      updatedAt: row.updatedAt,
    };
    current.fieldCount += 1;
    if (row.targetField) current.mappedCount += 1;
    if (!String(row.srcComment || "").trim()) current.emptyCommentCount += 1;
    if (row.updatedAt > current.updatedAt) current.updatedAt = row.updatedAt;
    groups.set(key, current);
  });

  return [...groups.values()]
    .map((item) => ({
      ...item,
      emptyCommentRate: item.fieldCount ? Math.round((item.emptyCommentCount / item.fieldCount) * 100) : 0,
    }))
    .sort(compareTableRowsDefault);
}

function buildStats(rows) {
  const tables = summarizeTables(rows);
  const mappedFields = rows.filter((row) => row.targetField).length;
  return {
    sourceSystemCount: new Set(rows.map((row) => row.srcSystem)).size,
    sourceTableCount: tables.length,
    fieldCount: rows.length,
    mappedFieldCount: mappedFields,
    unmappedFieldCount: rows.length - mappedFields,
    emptyCommentCount: rows.filter((row) => !String(row.srcComment || "").trim()).length,
    coverage: rows.length ? Math.round((mappedFields / rows.length) * 100) : 0,
  };
}

function getMockRows(params = {}) {
  const sortKey = String(params.sortKey || "").trim();
  const sortDirection = String(params.sortDirection || "").trim().toLowerCase() === "desc" ? "desc" : "asc";
  const rows = applyFilters(
    clone(FIELD_MAPPING_ROWS).map((row, index) => enrichRow({ ...row, __mockIndex: index })),
    params,
  );

  rows.sort((left, right) => {
    if (sortKey) return compareFieldRowsBySort(left, right, sortKey, sortDirection);
    return compareFieldRowsDefault(left, right);
  });
  return rows;
}

export async function getFieldMappingSourceSystems() {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/field-mappings/source-systems");
    return normalizeCollection(payload, "systems");
  }

  const counts = FIELD_MAPPING_ROWS.reduce((acc, row) => {
    const current = acc[row.srcSystem] || {
      name: row.srcSystem,
      count: 0,
      upstreamSystemId: resolveMockUpstreamSystemId(row),
    };
    current.count += 1;
    acc[row.srcSystem] = current;
    return acc;
  }, {});

  return Object.keys(counts)
    .sort()
    .map((name) => counts[name]);
}

export async function getFieldMappingStats(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/field-mappings/stats", {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeDetail(payload);
  }
  return buildStats(getMockRows(params));
}

export async function getFieldMappings(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/field-mappings/fields", {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizePaged(payload);
  }
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Number(params.pageSize || params.limit || FIELD_MAPPING_DEFAULT_PAGE_SIZE));
  const rows = getMockRows(params);
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

export async function getFieldMappingTables(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/field-mappings/tables", {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizePaged(payload);
  }
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Number(params.pageSize || params.limit || FIELD_MAPPING_DEFAULT_PAGE_SIZE));
  const rows = summarizeTables(getMockRows(params));
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}
