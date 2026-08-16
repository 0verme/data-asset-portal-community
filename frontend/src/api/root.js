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
import { assertValidRootAbbr } from "../utils/rootValidation.js";

import { ROOT_CATEGORIES, WORD_ROOTS } from "../data/roots.js";

const API_MODE = import.meta.env.VITE_API_MODE || "mock";
const DEFAULT_ROOT_CATEGORY = "公共词根";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let mockRoots = clone(WORD_ROOTS);

function readStore() {
  return clone(mockRoots);
}

function writeStore(items) {
  mockRoots = clone(items);
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
  throw new Error("Invalid root payload");
}

function sanitizeRootItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const abbr = String(item.abbr || "").trim();
  const cn = String(item.cn || "").trim();
  if (!abbr || !cn) return null;
  return {
    abbr,
    en: String(item.en || "").trim(),
    cn,
    cat: String(item.cat || "").trim() || DEFAULT_ROOT_CATEGORY,
    desc: String(item.desc || "").trim(),
  };
}

function sanitizeRoots(items) {
  return (Array.isArray(items) ? items : [])
    .map(sanitizeRootItem)
    .filter(Boolean);
}

function deriveCategoryNames(items) {
  const itemCategories = sanitizeRoots(items).map((item) => item.cat);
  return [...new Set([...ROOT_CATEGORIES.filter((item) => typeof item === "string"), ...itemCategories])];
}

export async function getRoots(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/roots", { params });
    return sanitizeRoots(normalizeCollection(payload, "roots"));
  }
  const items = sanitizeRoots(readStore());
  return items.filter((item) => {
    if (params.cat && item.cat !== params.cat) return false;
    if (!params.keyword) return true;
    const q = params.keyword.trim().toLowerCase();
    return [item.abbr, item.en, item.cn, item.desc].some((value) =>
      String(value || "").toLowerCase().includes(q),
    );
  });
}

export async function getRootCategories() {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/roots/categories");
    const categories = normalizeCollection(payload, "categories")
      .map((item) => {
        if (typeof item === "string") return { name: item, count: 0 };
        if (item && typeof item === "object") {
          return {
            name: String(item.name || item.cat || "").trim(),
            count: Number(item.count) || 0,
          };
        }
        return null;
      })
      .filter((item) => item?.name);
    return categories;
  }
  const items = sanitizeRoots(readStore());
  const counts = items.reduce((acc, item) => {
    acc[item.cat] = (acc[item.cat] || 0) + 1;
    return acc;
  }, {});
  return deriveCategoryNames(items).map((name) => ({ name, count: counts[name] || 0 }));
}

export async function saveRoot(root, oldAbbr) {
  if (API_MODE === "remote") {
    const payload = oldAbbr
      ? await requestRemote(`/roots/${encodeURIComponent(oldAbbr)}`, { method: "PUT", body: root })
      : await requestRemote("/roots", { method: "POST", body: root });
    return normalizeDetail(payload);
  }

  const items = sanitizeRoots(readStore());
  const normalizedRoot = sanitizeRootItem(root);
  if (!normalizedRoot) throw new Error("Invalid root payload");
  assertValidRootAbbr(normalizedRoot.abbr);
  const next = items.filter((item) => item.abbr !== oldAbbr && item.abbr !== normalizedRoot.abbr);
  next.unshift(normalizedRoot);
  writeStore(next);
  return clone(normalizedRoot);
}

export async function deleteRoot(abbr) {
  if (API_MODE === "remote") {
    await requestRemote(`/roots/${encodeURIComponent(abbr)}`, { method: "DELETE" });
    return;
  }
  writeStore(readStore().filter((item) => item.abbr !== abbr));
}

export async function importRoots(items) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/roots/import", {
      method: "POST",
      body: { items },
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeDetail(payload);
  }

  const current = sanitizeRoots(readStore());
  const normalizedItems = sanitizeRoots(items);
  normalizedItems.forEach((item) => assertValidRootAbbr(item.abbr));
  const map = new Map(current.map((item) => [item.abbr, item]));
  normalizedItems.forEach((item) => {
    map.set(item.abbr, clone(item));
  });
  const next = [...map.values()].sort((a, b) => a.abbr.localeCompare(b.abbr));
  writeStore(next);
  return {
    inserted: items.filter((item) => !current.some((currentItem) => currentItem.abbr === item.abbr)).length,
    updated: items.filter((item) => current.some((currentItem) => currentItem.abbr === item.abbr)).length,
    items: next,
  };
}

export async function resetRootOverrides() {
  mockRoots = clone(WORD_ROOTS);
}
