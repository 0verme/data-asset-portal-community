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

import mockPayload from "../data/commonCodes.js";

const API_MODE = import.meta.env.VITE_API_MODE || "mock";

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function getMockCategory(categoryCode) {
  return (mockPayload.categories || []).find((item) => item.code === categoryCode && item.active !== false);
}

export async function getCodeCategories() {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/common-codes/categories");
    return normalizeCollection(payload, "categories");
  }

  return (mockPayload.categories || []).filter((item) => item.active !== false).map((item) => ({
    code: item.code,
    name: item.name,
    desc: item.desc || "",
    active: item.active !== false,
    count: (item.items || []).filter((code) => code.active !== false).length,
  }));
}

export async function getCodeItems(categoryCode) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/common-codes/categories/${encodeURIComponent(categoryCode)}/items`);
    return normalizeCollection(payload, "items");
  }

  const category = getMockCategory(categoryCode);
  if (!category) {
    throw new Error(`Code category not found: ${categoryCode}`);
  }
  return (category.items || []).filter((item) => item.active !== false);
}

export async function getCodeItemsBatch(categoryCodes = []) {
  const codes = [...new Set(categoryCodes.map((code) => String(code || "").trim()).filter(Boolean))];
  if (API_MODE === "remote") {
    const payload = await requestRemote("/common-codes/items", {
      params: { codes: codes.join(",") },
    });
    return {
      categoryCodes: Array.isArray(payload?.categoryCodes) ? payload.categoryCodes : [],
      items: normalizeCollection(payload, "categories"),
      missingCodes: Array.isArray(payload?.missingCodes) ? payload.missingCodes : [],
    };
  }

  const items = [];
  const resolvedCodes = [];
  const missingCodes = [];
  for (const code of codes) {
    const category = getMockCategory(code);
    if (!category) {
      missingCodes.push(code);
      continue;
    }
    resolvedCodes.push(code);
    items.push(...(category.items || []).filter((item) => item.active !== false).map((item) => ({
      ...item,
      categoryCode: code,
    })));
  }
  return { categoryCodes: resolvedCodes, items, missingCodes };
}
