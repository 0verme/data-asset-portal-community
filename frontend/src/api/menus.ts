/// <reference types="vite/client" />
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

import { requestRemote } from './http.ts';
import { MENU_ITEMS, type MenuItem } from '../data/menus.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

export const MENUS_CHANGED_EVENT = 'data-asset-portal:menus-changed';
let mockMenus: MenuItem[] = clone(MENU_ITEMS as MenuItem[]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readMenus(): MenuItem[] {
  return clone(mockMenus);
}

function writeMenus(menus: MenuItem[]): void {
  mockMenus = clone(menus);
}

function notifyMenusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MENUS_CHANGED_EVENT));
}

function sortMenus(menus: readonly MenuItem[]): MenuItem[] {
  return menus
    .slice()
    .sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
}

function normalizeCollection(payload: unknown, fallbackKey?: string): MenuItem[] {
  if (Array.isArray(payload)) return payload as MenuItem[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as MenuItem[];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as MenuItem[];
  return [];
}

function normalizeDetail(payload: unknown): MenuItem {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as MenuItem;
  }
  throw new Error('Invalid menu payload');
}

function nowText(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function nextMenuId(menus: readonly MenuItem[]): string {
  const maxId = menus.reduce((maxValue, item) => {
    const value = Number(String(item.id || '').replace(/\D/g, '')) || 0;
    return Math.max(maxValue, value);
  }, 0);
  return String(maxId + 1);
}

export interface MenuPayload {
  code: string;
  name: string;
  id?: string | undefined;
  path?: string | undefined;
  icon?: string | undefined;
  order?: number | string | undefined;
  status?: string | undefined;
  adminOnly?: boolean | undefined;
  desc?: string | undefined;
  navPlacement?: string | undefined;
  updatedAt?: string | undefined;
  [key: string]: unknown;
}

interface MenuListResponseRecord {
  items?: MenuItem[] | undefined;
  menus?: MenuItem[] | undefined;
}

export async function getMenus(): Promise<MenuItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote<MenuListResponseRecord | MenuItem[]>('/system/menus', {
      suppressUnauthorizedEvent: true,
    });
    if (
      !Array.isArray(payload) &&
      !Array.isArray((payload as MenuListResponseRecord)?.items) &&
      !Array.isArray((payload as MenuListResponseRecord)?.menus)
    ) {
      throw new Error('Invalid menu list payload');
    }
    return normalizeCollection(payload, 'menus');
  }
  return sortMenus(readMenus());
}

export async function createMenu(payload: MenuPayload): Promise<MenuItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote('/system/menus', { method: 'POST', body: payload });
    const data = normalizeDetail(response);
    notifyMenusChanged();
    return data;
  }

  const menus = readMenus();
  if (menus.some((item) => item.code === payload.code)) {
    throw new Error(`Menu already exists: ${payload.code}`);
  }
  const maxOrder = menus.reduce((value, item) => Math.max(value, Number(item.order) || 0), 0);
  const nextItem: MenuItem = {
    id: nextMenuId(menus),
    code: payload.code,
    name: payload.name,
    icon: payload.icon || 'grid',
    path: payload.path || '',
    order: Number(payload.order) || maxOrder + 10,
    status: payload.status || 'enabled',
    adminOnly: Boolean(payload.adminOnly),
    desc: payload.desc || '',
    navPlacement: payload.navPlacement || 'more',
    updatedAt: nowText(),
  };
  writeMenus([...menus, nextItem]);
  notifyMenusChanged();
  return clone(nextItem);
}

export async function updateMenu(menuId: string, payload: MenuPayload): Promise<MenuItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/menus/${encodeURIComponent(menuId)}`, {
      method: 'PUT',
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
  const nextItem: MenuItem = {
    ...current,
    ...clone(payload),
    id: current.id,
    icon: payload.icon ?? current.icon,
    path: payload.path ?? current.path,
    order: payload.order !== undefined ? Number(payload.order) : current.order,
    status: payload.status ?? current.status,
    adminOnly: payload.adminOnly !== undefined ? Boolean(payload.adminOnly) : current.adminOnly,
    desc: payload.desc ?? current.desc,
    navPlacement: payload.navPlacement ?? current.navPlacement,
    updatedAt: nowText(),
  };
  writeMenus(menus.map((item) => (item.id === menuId ? nextItem : item)));
  notifyMenusChanged();
  return clone(nextItem);
}

export async function updateMenuStatus(menuId: string, status: string): Promise<MenuItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/menus/${encodeURIComponent(menuId)}/status`, {
      method: 'PATCH',
      body: { status },
    });
    const data = normalizeDetail(response);
    notifyMenusChanged();
    return data;
  }

  const menus = readMenus();
  const current = menus.find((item) => item.id === menuId);
  if (!current) throw new Error(`Menu not found: ${menuId}`);
  const nextItem: MenuItem = { ...current, status, updatedAt: nowText() };
  writeMenus(menus.map((item) => (item.id === menuId ? nextItem : item)));
  notifyMenusChanged();
  return clone(nextItem);
}

export async function moveMenu(menuId: string, direction: 'up' | 'down' | string): Promise<MenuItem[]> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/menus/${encodeURIComponent(menuId)}/move`, {
      method: 'PATCH',
      body: { direction },
    });
    const data = normalizeCollection(response, 'menus');
    notifyMenusChanged();
    return data;
  }

  const ordered = sortMenus(readMenus());
  const index = ordered.findIndex((item) => item.id === menuId);
  if (index < 0) throw new Error(`Menu not found: ${menuId}`);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered;
  const currentItem = ordered[index];
  const targetItem = ordered[target];
  if (!currentItem || !targetItem) return ordered;

  const swapOrder = targetItem.order;
  ordered[target] = { ...targetItem, order: currentItem.order, updatedAt: nowText() };
  ordered[index] = { ...currentItem, order: swapOrder, updatedAt: nowText() };
  writeMenus(ordered);
  notifyMenusChanged();
  return sortMenus(readMenus());
}

export async function deleteMenu(menuId: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/system/menus/${encodeURIComponent(menuId)}`, { method: 'DELETE' });
    notifyMenusChanged();
    return;
  }
  writeMenus(readMenus().filter((item) => item.id !== menuId));
  notifyMenusChanged();
}
