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
import { PARAM_DICT_CATEGORIES, PARAM_DICT_ITEMS } from "../data/paramDicts.ts";

const API_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase();
let mockCategories = clone(PARAM_DICT_CATEGORIES);
let mockItems = clone(PARAM_DICT_ITEMS);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readCategories() {
  return clone(mockCategories);
}

function writeCategories(categories) {
  mockCategories = clone(categories);
}

function readItems() {
  return clone(mockItems);
}

function writeItems(items) {
  mockItems = clone(items);
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
  throw new Error("Invalid parameter dictionary payload");
}

function nowText() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function nextDictId(items) {
  const maxId = items.reduce((maxValue, item) => {
    const value = Number(String(item.id || "").replace(/\D/g, "")) || 0;
    return Math.max(maxValue, value);
  }, 0);
  return `DICT${String(maxId + 1).padStart(3, "0")}`;
}

export async function getParamDictCategories() {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/system/param-dicts/categories");
    return normalizeCollection(payload, "categories");
  }

  const categories = readCategories();
  const items = readItems();
  return categories.map((category) => ({
    ...category,
    count: items.filter((item) => item.categoryCode === category.code).length,
  }));
}

export async function getParamDicts(categoryCode) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/system/param-dicts", {
      params: categoryCode ? { categoryCode } : {},
    });
    return normalizeCollection(payload, "items");
  }

  const categories = readCategories();
  const categoryMap = new Map(categories.map((item) => [item.code, item]));
  return readItems()
    .filter((item) => (!categoryCode ? true : item.categoryCode === categoryCode))
    .map((item) => ({
      ...item,
      categoryName: categoryMap.get(item.categoryCode)?.name || item.categoryCode,
    }));
}

export async function createParamDict(payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote("/system/param-dicts", { method: "POST", body: payload });
    return normalizeDetail(response);
  }

  const items = readItems();
  if (items.some((item) => item.categoryCode === payload.categoryCode && item.code === payload.code)) {
    throw new Error(`Parameter already exists: ${payload.categoryCode}/${payload.code}`);
  }
  const nextItem = {
    id: nextDictId(items),
    updatedAt: nowText(),
    ...clone(payload),
  };
  writeItems([nextItem, ...items]);
  return clone(nextItem);
}

export async function updateParamDict(dictId, payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/param-dicts/${encodeURIComponent(dictId)}`, {
      method: "PUT",
      body: payload,
    });
    return normalizeDetail(response);
  }

  const items = readItems();
  const current = items.find((item) => item.id === dictId);
  if (!current) throw new Error(`Parameter not found: ${dictId}`);
  if (items.some((item) => item.id !== dictId && item.categoryCode === payload.categoryCode && item.code === payload.code)) {
    throw new Error(`Parameter already exists: ${payload.categoryCode}/${payload.code}`);
  }
  const nextItem = {
    ...current,
    ...clone(payload),
    updatedAt: nowText(),
  };
  writeItems(items.map((item) => (item.id === dictId ? nextItem : item)));
  return clone(nextItem);
}

export async function updateParamDictStatus(dictId, status) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/param-dicts/${encodeURIComponent(dictId)}/status`, {
      method: "PATCH",
      body: { status },
    });
    return normalizeDetail(response);
  }

  const items = readItems();
  const current = items.find((item) => item.id === dictId);
  if (!current) throw new Error(`Parameter not found: ${dictId}`);
  const nextItem = {
    ...current,
    status,
    updatedAt: nowText(),
  };
  writeItems(items.map((item) => (item.id === dictId ? nextItem : item)));
  return clone(nextItem);
}

export async function deleteParamDict(dictId) {
  if (API_MODE === "remote") {
    await requestRemote(`/system/param-dicts/${encodeURIComponent(dictId)}`, { method: "DELETE" });
    return;
  }
  writeItems(readItems().filter((item) => item.id !== dictId));
}

export async function updateParamDictCategoryStatus(categoryCode, status) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/param-dicts/categories/${encodeURIComponent(categoryCode)}/status`, {
      method: "PATCH",
      body: { status },
    });
    return normalizeDetail(response);
  }

  const categories = readCategories();
  const current = categories.find((item) => item.code === categoryCode);
  if (!current) throw new Error(`Category not found: ${categoryCode}`);
  const nextCategory = { ...current, status };
  writeCategories(categories.map((item) => (item.code === categoryCode ? nextCategory : item)));
  return clone(nextCategory);
}
