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
import { MENU_ITEMS } from "../data/menus.ts";

const API_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase();
export const MENUS_CHANGED_EVENT = "data-asset-portal:menus-changed";
let mockMenus = clone(MENU_ITEMS);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readMenus() {
  return clone(mockMenus);
}

function writeMenus(menus) {
  mockMenus = clone(menus);
}

function notifyMenusChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MENUS_CHANGED_EVENT));
}

function sortMenus(menus) {
  return menus
    .slice()
    .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
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
  throw new Error("Invalid menu payload");
}

function nowText() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function nextMenuId(menus) {
  const maxId = menus.reduce((maxValue, item) => {
    const value = Number(String(item.id || "").replace(/\D/g, "")) || 0;
    return Math.max(maxValue, value);
  }, 0);
  return String(maxId + 1);
}

export async function getMenus() {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/system/menus", { suppressUnauthorizedEvent: true });
    if (
      !Array.isArray(payload)
      && !Array.isArray(payload?.items)
      && !Array.isArray(payload?.menus)
    ) {
      throw new Error("Invalid menu list payload");
    }
    return normalizeCollection(payload, "menus");
  }
  return sortMenus(readMenus());
}

export async function createMenu(payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote("/system/menus", { method: "POST", body: payload });
    const data = normalizeDetail(response);
    notifyMenusChanged();
    return data;
  }

  const menus = readMenus();
  if (menus.some((item) => item.code === payload.code)) {
    throw new Error(`Menu already exists: ${payload.code}`);
  }
  const maxOrder = menus.reduce((value, item) => Math.max(value, Number(item.order) || 0), 0);
  const nextItem = {
    ...clone(payload),
    id: nextMenuId(menus),
    order: Number(payload.order) || maxOrder + 10,
    navPlacement: payload.navPlacement || "more",
    updatedAt: nowText(),
  };
  writeMenus([...menus, nextItem]);
  notifyMenusChanged();
  return clone(nextItem);
}

export async function updateMenu(menuId, payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/menus/${encodeURIComponent(menuId)}`, {
      method: "PUT",
      body: payload,
    });
    const data = normalizeDetail(response);
    notifyMenusChanged();
    return data;
  }

  const menus = readMenus();
  const current = menus.find((item) => item.id === menuId);
  if (!current) throw new Error(`Menu not found: ${menuId}`);
  if (menus.some((item) => item.id !== menuId && item.code === payload.code)) {
    throw new Error(`Menu already exists: ${payload.code}`);
  }
  const nextItem = { ...current, ...clone(payload), id: current.id, updatedAt: nowText() };
  writeMenus(menus.map((item) => (item.id === menuId ? nextItem : item)));
  notifyMenusChanged();
  return clone(nextItem);
}

export async function updateMenuStatus(menuId, status) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/menus/${encodeURIComponent(menuId)}/status`, {
      method: "PATCH",
      body: { status },
    });
    const data = normalizeDetail(response);
    notifyMenusChanged();
    return data;
  }

  const menus = readMenus();
  const current = menus.find((item) => item.id === menuId);
  if (!current) throw new Error(`Menu not found: ${menuId}`);
  const nextItem = { ...current, status, updatedAt: nowText() };
  writeMenus(menus.map((item) => (item.id === menuId ? nextItem : item)));
  notifyMenusChanged();
  return clone(nextItem);
}

export async function moveMenu(menuId, direction) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/menus/${encodeURIComponent(menuId)}/move`, {
      method: "PATCH",
      body: { direction },
    });
    const data = normalizeCollection(response, "menus");
    notifyMenusChanged();
    return data;
  }

  const ordered = sortMenus(readMenus());
  const index = ordered.findIndex((item) => item.id === menuId);
  if (index < 0) throw new Error(`Menu not found: ${menuId}`);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered;
  const swapOrder = ordered[target].order;
  ordered[target] = { ...ordered[target], order: ordered[index].order, updatedAt: nowText() };
  ordered[index] = { ...ordered[index], order: swapOrder, updatedAt: nowText() };
  writeMenus(ordered);
  notifyMenusChanged();
  return sortMenus(readMenus());
}

export async function deleteMenu(menuId) {
  if (API_MODE === "remote") {
    await requestRemote(`/system/menus/${encodeURIComponent(menuId)}`, { method: "DELETE" });
    notifyMenusChanged();
    return;
  }
  writeMenus(readMenus().filter((item) => item.id !== menuId));
  notifyMenusChanged();
}
