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

import { DWM_TABLES } from "../data/tables.js";
import { DOMAIN_ORDER, LAYER_OPTIONS } from "../config/assets.js";
import { LONG_REQUEST_TIMEOUT } from "../config/request.js";
import { normalizeAssetDataTypes, normalizeFieldList } from "../constants/dataTypes.js";
import { getAssetLayerValue, normalizeAssetLayerFields } from "../utils/assetFilters.js";
import { generateDDLByDialect, getDDLDialectLabel, normalizeDDLResponse } from "../utils/ddlDialect.js";
import { requestRemote } from "./http.js";

const API_MODE = import.meta.env.VITE_API_MODE || "mock";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildLayerVariantName(name, layerCode) {
  const nextPrefix = `${String(layerCode || "").trim().toLowerCase()}_`;
  if (/^[a-z]+_/.test(name)) {
    return name.replace(/^[a-z]+_/, nextPrefix);
  }
  return `${nextPrefix}${name}`;
}

function createLayerVariants(tables, layerCode) {
  return tables.map((table) => ({
    ...clone(table),
    name: buildLayerVariantName(table.name, layerCode),
    layer: layerCode,
    tier: layerCode,
    schemaLayer: layerCode,
    dataLayer: layerCode,
    schema: `DWS_${layerCode}`,
  }));
}

const MOCK_TABLES = [
  ...DWM_TABLES,
  ...LAYER_OPTIONS
    .filter((layer) => layer.code !== "DWM")
    .flatMap((layer) => createLayerVariants(DWM_TABLES, layer.code)),
];

let mockOverrides = { upserts: {}, deletedNames: [] };

function readOverrides() {
  return {
    upserts: mockOverrides && typeof mockOverrides.upserts === "object" && mockOverrides.upserts
      ? clone(mockOverrides.upserts)
      : {},
    deletedNames: Array.isArray(mockOverrides?.deletedNames) ? [...mockOverrides.deletedNames] : [],
  };
}

function writeOverrides(overrides) {
  mockOverrides = {
    upserts: clone(overrides?.upserts || {}),
    deletedNames: Array.isArray(overrides?.deletedNames) ? [...overrides.deletedNames] : [],
  };
}

function applyOverrides(tables) {
  const { upserts, deletedNames } = readOverrides();
  const deletedSet = new Set(deletedNames);
  const merged = tables
    .filter((table) => !deletedSet.has(table.name))
    .map((table) => clone(upserts[table.name] || table));

  Object.values(upserts).forEach((table) => {
    if (!table || deletedSet.has(table.name)) return;
    if (merged.some((item) => item.name === table.name)) return;
    merged.unshift(clone(table));
  });

  return merged;
}

function normalizeTable(table) {
  return normalizeAssetLayerFields(normalizeAssetDataTypes(clone(table)));
}

function normalizeTableCollection(tables) {
  return Array.isArray(tables) ? tables.map(normalizeTable) : [];
}

function getMockTables(params = {}) {
  const { layer, domain } = params;
  const normalizedLayer = typeof layer === "string" ? layer.trim().toUpperCase() : "";

  return MOCK_TABLES.filter((table) => {
    const tableLayer = getAssetLayerValue(table);
    if (normalizedLayer && tableLayer !== normalizedLayer) return false;
    if (domain && table.domain !== domain) return false;
    return true;
  });
}

async function getMockAssetTables(params = {}) {
  return normalizeTableCollection(applyOverrides(clone(getMockTables(params))));
}

async function getMockAssetDetail(tableName) {
  const table = normalizeTableCollection(applyOverrides(clone(getMockTables()))).find((item) => item.name === tableName);
  if (!table) {
    throw new Error(`未找到数据表: ${tableName}`);
  }
  return table;
}

async function getMockAssetFields(tableName) {
  return normalizeFieldList(clone((await getMockAssetDetail(tableName)).fields));
}

async function getMockAssetDDL(tableName) {
  const table = await getMockAssetDetail(tableName);
  const ddlDialect = "postgresql";
  return {
    ddl: generateDDLByDialect(table, ddlDialect),
    ddlDialect,
    ddlDialectLabel: getDDLDialectLabel(ddlDialect, { mock: true }),
  };
}

async function getMockDomains({ layer } = {}) {
  const counts = applyOverrides(getMockTables()).filter((table) =>
    !layer || getAssetLayerValue(table) === layer).reduce((acc, table) => {
    acc[table.domain] = (acc[table.domain] || 0) + 1;
    return acc;
  }, {});

  return DOMAIN_ORDER.filter((name) => counts[name]).map((name) => ({
    name,
    count: counts[name],
  }));
}

async function getMockLayers({ domain } = {}) {
  const counts = applyOverrides(getMockTables()).filter((table) =>
    !domain || table.domain === domain).reduce((acc, table) => {
    const layer = getAssetLayerValue(table);
    if (!layer) return acc;
    acc[layer] = (acc[layer] || 0) + 1;
    return acc;
  }, {});

  return LAYER_OPTIONS.map((layer) => ({
    ...layer,
    count: counts[layer.code] || 0,
  }));
}

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.data && typeof payload.data === "object" ? payload.data : payload;
  }

  throw new Error("接口返回的表详情格式不正确。");
}

export async function getAssetTables(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/assets/tables", { params });
    return normalizeTableCollection(normalizeCollection(payload, "tables"));
  }

  return getMockAssetTables(params);
}

export async function getAssetTablePage(params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || 20);
  if (API_MODE === "remote") {
    const payload = await requestRemote("/assets/tables", {
      params: { ...params, page, pageSize, summary: true },
    });
    return {
      items: normalizeTableCollection(normalizeCollection(payload, "tables")),
      page: Number(payload?.page) || page,
      pageSize: Number(payload?.pageSize) || pageSize,
      total: Number(payload?.total) || 0,
    };
  }

  const keyword = String(params.keyword || "").trim().toLowerCase();
  const matches = (await getMockAssetTables(params)).map((table) => {
    if (!keyword) return { ...table, _fieldMatch: null };
    const nameHit = [table.name, table.cn, table.owner].some((value) =>
      String(value || "").toLowerCase().includes(keyword));
    const fieldHit = table.fields.find((field) =>
      [field.name, field.cn].some((value) => String(value || "").toLowerCase().includes(keyword)));
    if (!nameHit && !fieldHit) return null;
    return { ...table, _fieldMatch: fieldHit ? `${fieldHit.name} ${fieldHit.cn}` : null };
  }).filter(Boolean);
  const start = (page - 1) * pageSize;
  return {
    items: matches.slice(start, start + pageSize).map((table) => ({
      ...table,
      fieldCount: table.fields.length,
      fields: [],
    })),
    page,
    pageSize,
    total: matches.length,
  };
}

export async function getAssetDetail(tableName) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}`);
    return normalizeTable(normalizeDetail(payload));
  }

  return getMockAssetDetail(tableName);
}

export async function getAssetFields(tableName) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}/fields`);
    return normalizeFieldList(normalizeCollection(payload, "fields"));
  }

  return getMockAssetFields(tableName);
}

export async function getAssetDDL(tableName) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}/ddl`, {
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeDDLResponse(payload);
  }

  return getMockAssetDDL(tableName);
}

export async function getDomains(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/assets/domains", { params });
    return normalizeCollection(payload, "domains");
  }

  return getMockDomains(params);
}

export async function getLayers(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/assets/layers", { params });
    return normalizeCollection(payload, "layers");
  }

  return getMockLayers(params);
}

export async function saveAssetTable(table, oldName) {
  const normalizedTable = normalizeTable(table);
  if (API_MODE === "remote") {
    if (oldName) {
      const payload = await requestRemote(`/assets/tables/${encodeURIComponent(oldName)}`, {
        method: "PUT",
        body: normalizedTable,
        timeout: LONG_REQUEST_TIMEOUT,
      });
      return normalizeTable(normalizeDetail(payload));
    }

    const payload = await requestRemote("/assets/tables", {
      method: "POST",
      body: normalizedTable,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeTable(normalizeDetail(payload));
  }

  const overrides = readOverrides();
  const nextUpserts = { ...overrides.upserts };
  const nextDeleted = new Set(overrides.deletedNames);

  if (oldName && oldName !== table.name) {
    delete nextUpserts[oldName];
    nextDeleted.add(oldName);
  }

  nextUpserts[normalizedTable.name] = normalizedTable;
  nextDeleted.delete(normalizedTable.name);

  writeOverrides({
    upserts: nextUpserts,
    deletedNames: [...nextDeleted],
  });

  return normalizeTable(normalizedTable);
}

export async function deleteAssetTable(tableName) {
  if (API_MODE === "remote") {
    await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}`, {
      method: "DELETE",
    });
    return;
  }

  const overrides = readOverrides();
  const nextUpserts = { ...overrides.upserts };
  delete nextUpserts[tableName];

  const nextDeleted = new Set(overrides.deletedNames);
  nextDeleted.add(tableName);

  writeOverrides({
    upserts: nextUpserts,
    deletedNames: [...nextDeleted],
  });
}

export async function resetAssetOverrides() {
  mockOverrides = { upserts: {}, deletedNames: [] };
}
