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
import { INDICATORS } from "../data/indicators.js";
import {
  getIndicatorDimensionFromPath,
  INDICATOR_PATH_OPTIONS,
  normalizeIndicatorDimension,
} from "../data/indicatorPathOptions.js";

const API_MODE = import.meta.env?.VITE_API_MODE || "mock";
let mockIndicators = clone(INDICATORS);

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const detail = payload.data && typeof payload.data === "object" ? payload.data : payload;
    return normalizeIndicator(detail);
  }
  throw new Error("Invalid indicator payload");
}

function firstPresent(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function normalizeOptionalId(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function normalizeIndicator(item) {
  if (!item || typeof item !== "object") return item;
  const path = firstPresent(item, ["path", "path_desc", "indicator_path", "metric_path", "path_name"], "");
  const dimension = getIndicatorDimensionFromPath(path) || normalizeIndicatorDimension(
    firstPresent(item, ["dimension", "dimension_code", "dimensionCode"], ""),
  );
  const resultTableName = firstPresent(item, ["resultTableName", "result_table_name", "resultTable", "result_table"], "");
  const resultFieldName = firstPresent(item, ["resultFieldName", "result_field_name", "resultField", "result_field"], "");
  const sourceAssetId = normalizeOptionalId(firstPresent(item, ["sourceAssetId", "source_asset_id"], null));
  const resultFieldId = normalizeOptionalId(firstPresent(item, ["resultFieldId", "result_field_id"], null));
  const aggregation = firstPresent(item, ["aggregation", "aggregationCode", "aggregation_code"], null);
  const semanticState = firstPresent(item, ["semanticState", "semantic_state", "certificationStatus"], "candidate");
  return {
    ...item,
    path,
    dimension,
    resultTableName,
    resultFieldName,
    sourceAssetId,
    sourceAssetName: firstPresent(item, ["sourceAssetName", "source_asset_name"], null),
    sourceAssetQualifiedName: firstPresent(item, ["sourceAssetQualifiedName", "source_asset_qualified_name"], null),
    resultFieldId,
    aggregation,
    semanticState,
  };
}

function filterIndicators(items, params = {}) {
  const keyword = String(params.keyword || "").trim().toLowerCase();
  return items.filter((item) => {
    if (params.dimension && params.dimension !== "all" && item.dimension !== params.dimension) return false;
    if (params.status && params.status !== "all" && item.status !== params.status) return false;
    if (!keyword) return true;
    return [
      item.id,
      item.name,
      item.meaning,
      item.resultTableName,
      item.resultFieldName,
      item.caliber,
      item.path,
      item.registrar,
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
  });
}

function readStore() {
  return clone(mockIndicators);
}

function writeStore(items) {
  mockIndicators = clone(items);
}

function normalizePathTree(payload) {
  if (Array.isArray(payload)) return clone(payload);
  if (payload && Array.isArray(payload.items)) return clone(payload.items);
  if (payload?.data && Array.isArray(payload.data)) return clone(payload.data);
  return [];
}

export async function getIndicatorList(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/indicators", { params });
    return normalizeCollection(payload, "items").map(normalizeIndicator);
  }
  return filterIndicators(readStore().map(normalizeIndicator), params);
}

export async function getIndicatorDetail(indicatorId) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}`);
    return normalizeDetail(payload);
  }
  const item = readStore().find((indicator) => indicator.id === indicatorId);
  if (!item) throw new Error(`Indicator not found: ${indicatorId}`);
  return normalizeIndicator(clone(item));
}

export async function getIndicatorPathTree(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/indicator-path/tree", { params });
    return normalizePathTree(payload);
  }
  return clone(INDICATOR_PATH_OPTIONS);
}

export async function createIndicator(payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote("/indicators", { method: "POST", body: payload });
    return normalizeDetail(response);
  }
  const items = readStore();
  if (items.some((item) => item.id === payload.id)) {
    throw new Error(`Indicator already exists: ${payload.id}`);
  }
  items.unshift(clone(payload));
  writeStore(items);
  return normalizeIndicator(clone(payload));
}

export async function updateIndicator(indicatorId, payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}`, {
      method: "PUT",
      body: payload,
    });
    return normalizeDetail(response);
  }
  const items = readStore();
  const current = items.find((item) => item.id === indicatorId);
  if (!current) throw new Error(`Indicator not found: ${indicatorId}`);
  if (payload.id !== indicatorId && items.some((item) => item.id === payload.id)) {
    throw new Error(`Indicator already exists: ${payload.id}`);
  }
  writeStore([clone(payload), ...items.filter((item) => item.id !== indicatorId && item.id !== payload.id)]);
  return normalizeIndicator(clone(payload));
}

export async function deleteIndicator(indicatorId) {
  if (API_MODE === "remote") {
    await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}`, { method: "DELETE" });
    return;
  }
  writeStore(readStore().filter((item) => item.id !== indicatorId));
}

export async function updateIndicatorStatus(indicatorId, status) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}/status`, {
      method: "PATCH",
      body: { status },
    });
    return normalizeDetail(payload);
  }
  const item = readStore().find((indicator) => indicator.id === indicatorId);
  if (!item) throw new Error(`Indicator not found: ${indicatorId}`);
  const next = { ...item, status };
  writeStore(readStore().map((current) => (current.id === indicatorId ? next : current)));
  return clone(next);
}
