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
import { LONG_REQUEST_TIMEOUT } from '../config/request.ts';
import { assertValidRootAbbr } from '../utils/rootValidation.ts';
import { ROOT_CATEGORIES, WORD_ROOTS } from '../data/roots.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

const DEFAULT_ROOT_CATEGORY = '公共词根';

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }
}

export interface SanitizedWordRoot {
  abbr: string;
  en: string;
  cn: string;
  cat: string;
  desc: string;
}

export interface RootCategoryItem {
  name: string;
  count: number;
}

export interface RootQueryParams {
  cat?: string | undefined;
  keyword?: string | undefined;
  [key: string]: unknown;
}

export interface RootImportResult {
  inserted: number;
  updated: number;
  items: SanitizedWordRoot[];
}

let mockRoots: SanitizedWordRoot[] = sanitizeRoots(clone(WORD_ROOTS as unknown[]));

function readStore(): SanitizedWordRoot[] {
  return clone(mockRoots);
}

function writeStore(items: SanitizedWordRoot[]): void {
  mockRoots = clone(items);
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
  throw new Error('Invalid root payload');
}

function sanitizeRootItem(item: unknown): SanitizedWordRoot | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const abbr = String(record['abbr'] || '').trim();
  const cn = String(record['cn'] || '').trim();
  if (!abbr || !cn) return null;
  return {
    abbr,
    en: String(record['en'] || '').trim(),
    cn,
    cat: String(record['cat'] || '').trim() || DEFAULT_ROOT_CATEGORY,
    desc: String(record['desc'] || '').trim(),
  };
}

function sanitizeRoots(items: unknown[]): SanitizedWordRoot[] {
  return (Array.isArray(items) ? items : [])
    .map(sanitizeRootItem)
    .filter((item): item is SanitizedWordRoot => Boolean(item));
}

function deriveCategoryNames(items: readonly SanitizedWordRoot[]): string[] {
  const itemCategories = items.map((item) => item.cat);
  return [...new Set([...ROOT_CATEGORIES.filter((item) => typeof item === 'string'), ...itemCategories])];
}

export async function getRoots(params: RootQueryParams = {}): Promise<SanitizedWordRoot[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/roots', { params });
    return sanitizeRoots(normalizeCollection(payload, 'roots'));
  }
  const items = sanitizeRoots(readStore());
  return items.filter((item) => {
    if (params.cat && item.cat !== params.cat) return false;
    if (!params.keyword) return true;
    const q = params.keyword.trim().toLowerCase();
    return [item.abbr, item.en, item.cn, item.desc].some((value) =>
      String(value || '').toLowerCase().includes(q),
    );
  });
}

export async function getRootCategories(): Promise<RootCategoryItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/roots/categories');
    const categories = normalizeCollection<unknown>(payload, 'categories')
      .map((item) => {
        if (typeof item === 'string') return { name: item, count: 0 };
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return {
            name: String(record['name'] || record['cat'] || '').trim(),
            count: Number(record['count']) || 0,
          };
        }
        return null;
      })
      .filter((item): item is RootCategoryItem => Boolean(item?.name));
    return categories;
  }
  const items = sanitizeRoots(readStore());
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.cat] = (acc[item.cat] || 0) + 1;
    return acc;
  }, {});
  return deriveCategoryNames(items).map((name) => ({ name, count: counts[name] || 0 }));
}

export async function saveRoot(root: unknown, oldAbbr?: string): Promise<SanitizedWordRoot> {
  if (API_MODE === 'remote') {
    const payload = oldAbbr
      ? await requestRemote(`/roots/${encodeURIComponent(oldAbbr)}`, { method: 'PUT', body: root })
      : await requestRemote('/roots', { method: 'POST', body: root });
    return normalizeDetail<SanitizedWordRoot>(payload);
  }

  const items = sanitizeRoots(readStore());
  const normalizedRoot = sanitizeRootItem(root);
  if (!normalizedRoot) throw new Error('Invalid root payload');
  assertValidRootAbbr(normalizedRoot.abbr);
  const next = items.filter((item) => item.abbr !== oldAbbr && item.abbr !== normalizedRoot.abbr);
  next.unshift(normalizedRoot);
  writeStore(next);
  return clone(normalizedRoot);
}

export async function deleteRoot(abbr: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/roots/${encodeURIComponent(abbr)}`, { method: 'DELETE' });
    return;
  }
  writeStore(readStore().filter((item) => item.abbr !== abbr));
}

export async function importRoots(items: unknown[]): Promise<RootImportResult> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/roots/import', {
      method: 'POST',
      body: { items },
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeDetail<RootImportResult>(payload);
  }

  const current = sanitizeRoots(readStore());
  const normalizedItems = sanitizeRoots(items);
  normalizedItems.forEach((item) => assertValidRootAbbr(item.abbr));
  const map = new Map<string, SanitizedWordRoot>(current.map((item) => [item.abbr, item]));
  normalizedItems.forEach((item) => {
    map.set(item.abbr, clone(item));
  });
  const next = [...map.values()].sort((a, b) => a.abbr.localeCompare(b.abbr));
  writeStore(next);
  return {
    inserted: items.filter((item) => {
      const sanitized = sanitizeRootItem(item);
      return sanitized && !current.some((currentItem) => currentItem.abbr === sanitized.abbr);
    }).length,
    updated: items.filter((item) => {
      const sanitized = sanitizeRootItem(item);
      return sanitized && current.some((currentItem) => currentItem.abbr === sanitized.abbr);
    }).length,
    items: next,
  };
}

export async function resetRootOverrides(): Promise<void> {
  mockRoots = sanitizeRoots(clone(WORD_ROOTS as unknown[]));
}
