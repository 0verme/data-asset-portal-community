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
import {
  PARAM_DICT_CATEGORIES,
  PARAM_DICT_ITEMS,
  type ParamDictCategory,
  type ParamDictItem,
} from '../data/paramDicts.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

let mockCategories: ParamDictCategory[] = clone(PARAM_DICT_CATEGORIES as ParamDictCategory[]);
let mockItems: ParamDictItem[] = clone(PARAM_DICT_ITEMS as ParamDictItem[]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readCategories(): ParamDictCategory[] {
  return clone(mockCategories);
}

function writeCategories(categories: ParamDictCategory[]): void {
  mockCategories = clone(categories);
}

function readItems(): ParamDictItem[] {
  return clone(mockItems);
}

function writeItems(items: ParamDictItem[]): void {
  mockItems = clone(items);
}

function normalizeCollection<T>(payload: unknown, fallbackKey?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as T[];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as T[];
  return [];
}

function normalizeDetail<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as T;
  }
  throw new Error('Invalid parameter dictionary payload');
}

function nowText(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function nextDictId(items: readonly ParamDictItem[]): string {
  const maxId = items.reduce((maxValue, item) => {
    const value = Number(String(item.id || '').replace(/\D/g, '')) || 0;
    return Math.max(maxValue, value);
  }, 0);
  return `DICT${String(maxId + 1).padStart(3, '0')}`;
}

export interface ParamDictCategoryWithCount extends ParamDictCategory {
  count: number;
}

export interface ParamDictItemWithCategoryName extends ParamDictItem {
  categoryName?: string | undefined;
}

export interface ParamDictPayload {
  categoryCode: string;
  code: string;
  name: string;
  value?: string | undefined;
  desc?: string | undefined;
  status?: string | undefined;
  id?: string | undefined;
  updatedAt?: string | undefined;
  [key: string]: unknown;
}

export async function getParamDictCategories(): Promise<ParamDictCategoryWithCount[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/system/param-dicts/categories');
    return normalizeCollection<ParamDictCategoryWithCount>(payload, 'categories');
  }

  const categories = readCategories();
  const items = readItems();
  return categories.map((category) => ({
    ...category,
    count: items.filter((item) => item.categoryCode === category.code).length,
  }));
}

export async function getParamDicts(categoryCode?: string): Promise<ParamDictItemWithCategoryName[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/system/param-dicts', {
      params: categoryCode ? { categoryCode } : {},
    });
    return normalizeCollection<ParamDictItemWithCategoryName>(payload, 'items');
  }

  const categories = readCategories();
  const categoryMap = new Map<string, ParamDictCategory>(categories.map((item) => [item.code, item]));
  return readItems()
    .filter((item) => (!categoryCode ? true : item.categoryCode === categoryCode))
    .map((item) => ({
      ...item,
      categoryName: categoryMap.get(item.categoryCode)?.name || item.categoryCode,
    }));
}

export async function createParamDict(payload: ParamDictPayload): Promise<ParamDictItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote('/system/param-dicts', { method: 'POST', body: payload });
    return normalizeDetail<ParamDictItem>(response);
  }

  const items = readItems();
  if (items.some((item) => item.categoryCode === payload.categoryCode && item.code === payload.code)) {
    throw new Error(`Parameter already exists: ${payload.categoryCode}/${payload.code}`);
  }
  const nextItem: ParamDictItem = {
    id: nextDictId(items),
    categoryCode: payload.categoryCode,
    code: payload.code,
    name: payload.name,
    value: payload.value ?? payload.name,
    desc: payload.desc ?? '',
    status: payload.status ?? 'enabled',
    updatedAt: nowText(),
  };
  writeItems([nextItem, ...items]);
  return clone(nextItem);
}

export async function updateParamDict(dictId: string, payload: ParamDictPayload): Promise<ParamDictItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/param-dicts/${encodeURIComponent(dictId)}`, {
      method: 'PUT',
      body: payload,
    });
    return normalizeDetail<ParamDictItem>(response);
  }

  const items = readItems();
  const current = items.find((item) => item.id === dictId);
  if (!current) throw new Error(`Parameter not found: ${dictId}`);
  if (
    items.some(
      (item) => item.id !== dictId && item.categoryCode === payload.categoryCode && item.code === payload.code,
    )
  ) {
    throw new Error(`Parameter already exists: ${payload.categoryCode}/${payload.code}`);
  }
  const nextItem: ParamDictItem = {
    ...current,
    ...clone(payload),
    id: current.id,
    value: payload.value ?? current.value,
    desc: payload.desc ?? current.desc,
    status: payload.status ?? current.status,
    updatedAt: nowText(),
  };
  writeItems(items.map((item) => (item.id === dictId ? nextItem : item)));
  return clone(nextItem);
}

export async function updateParamDictStatus(dictId: string, status: string): Promise<ParamDictItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/param-dicts/${encodeURIComponent(dictId)}/status`, {
      method: 'PATCH',
      body: { status },
    });
    return normalizeDetail<ParamDictItem>(response);
  }

  const items = readItems();
  const current = items.find((item) => item.id === dictId);
  if (!current) throw new Error(`Parameter not found: ${dictId}`);
  const nextItem: ParamDictItem = {
    ...current,
    status,
    updatedAt: nowText(),
  };
  writeItems(items.map((item) => (item.id === dictId ? nextItem : item)));
  return clone(nextItem);
}

export async function deleteParamDict(dictId: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/system/param-dicts/${encodeURIComponent(dictId)}`, { method: 'DELETE' });
    return;
  }
  writeItems(readItems().filter((item) => item.id !== dictId));
}

export async function updateParamDictCategoryStatus(
  categoryCode: string,
  status: string,
): Promise<ParamDictCategory> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/param-dicts/categories/${encodeURIComponent(categoryCode)}/status`, {
      method: 'PATCH',
      body: { status },
    });
    return normalizeDetail<ParamDictCategory>(response);
  }

  const categories = readCategories();
  const current = categories.find((item) => item.code === categoryCode);
  if (!current) throw new Error(`Category not found: ${categoryCode}`);
  const nextCategory: ParamDictCategory = { ...current, status };
  writeCategories(categories.map((item) => (item.code === categoryCode ? nextCategory : item)));
  return clone(nextCategory);
}
