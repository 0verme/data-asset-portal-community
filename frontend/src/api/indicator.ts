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
import { INDICATORS, type MockIndicatorItem } from '../data/indicators.ts';
import {
  getIndicatorDimensionFromPath,
  INDICATOR_PATH_OPTIONS,
  normalizeIndicatorDimension,
} from '../data/indicatorPathOptions.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

let mockIndicators: MockIndicatorItem[] = clone(INDICATORS);

function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeCollection(payload: unknown, fallbackKey?: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as unknown[];
  return [];
}

function normalizeDetail(payload: unknown): MockIndicatorItem {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const detail = record['data'] && typeof record['data'] === 'object' ? record['data'] : payload;
    return normalizeIndicator(detail);
  }
  throw new Error('Invalid indicator payload');
}

function firstPresent(item: Record<string, unknown> | null | undefined, keys: readonly string[], fallback = ''): string {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return fallback;
}

function firstPresentNullable(
  item: Record<string, unknown> | null | undefined,
  keys: readonly string[],
  fallback: string | null = null,
): string | null {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return fallback;
}

function normalizeOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function normalizeIndicator(item: unknown): MockIndicatorItem {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid indicator item');
  }
  const record = item as Record<string, unknown>;
  const path = firstPresent(record, ['path', 'path_desc', 'indicator_path', 'metric_path', 'path_name'], '');
  const dimension =
    getIndicatorDimensionFromPath(path) ||
    normalizeIndicatorDimension(firstPresent(record, ['dimension', 'dimension_code', 'dimensionCode'], ''));
  const resultTableName = firstPresent(
    record,
    ['resultTableName', 'result_table_name', 'resultTable', 'result_table'],
    '',
  );
  const resultFieldName = firstPresent(
    record,
    ['resultFieldName', 'result_field_name', 'resultField', 'result_field'],
    '',
  );
  const sourceAssetId = normalizeOptionalId(firstPresentNullable(record, ['sourceAssetId', 'source_asset_id'], null));
  const resultFieldId = normalizeOptionalId(firstPresentNullable(record, ['resultFieldId', 'result_field_id'], null));
  const aggregation = firstPresentNullable(record, ['aggregation', 'aggregationCode', 'aggregation_code'], null);
  const semanticState = firstPresent(record, ['semanticState', 'semantic_state', 'certificationStatus'], 'candidate');

  return {
    id: String(record['id'] || ''),
    name: String(record['name'] || ''),
    meaning: String(record['meaning'] || ''),
    resultTableName,
    resultFieldName,
    sourceAssetId,
    sourceAssetName: firstPresentNullable(record, ['sourceAssetName', 'source_asset_name'], null),
    sourceAssetQualifiedName: firstPresentNullable(record, ['sourceAssetQualifiedName', 'source_asset_qualified_name'], null),
    resultFieldId,
    aggregation,
    semanticState,
    dimension,
    caliber: String(record['caliber'] || ''),
    path,
    registrar: String(record['registrar'] || ''),
    registeredAt: String(record['registeredAt'] || ''),
    status: String(record['status'] || 'published'),
  };
}

export interface IndicatorQueryParams {
  keyword?: string | undefined;
  dimension?: string | undefined;
  status?: string | undefined;
  [key: string]: unknown;
}

function filterIndicators(items: readonly MockIndicatorItem[], params: IndicatorQueryParams = {}): MockIndicatorItem[] {
  const keyword = String(params.keyword || '').trim().toLowerCase();
  return items.filter((item) => {
    if (params.dimension && params.dimension !== 'all' && item.dimension !== params.dimension) return false;
    if (params.status && params.status !== 'all' && item.status !== params.status) return false;
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
    ].some((value) => String(value || '').toLowerCase().includes(keyword));
  });
}

function readStore(): MockIndicatorItem[] {
  return clone(mockIndicators);
}

function writeStore(items: MockIndicatorItem[]): void {
  mockIndicators = clone(items);
}

function normalizePathTree(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return clone(payload);
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return clone(record['items']);
  if (record?.['data'] && Array.isArray(record['data'])) return clone(record['data']);
  return [];
}

export async function getIndicatorList(params: IndicatorQueryParams = {}): Promise<MockIndicatorItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/indicators', { params });
    return normalizeCollection(payload, 'items').map(normalizeIndicator);
  }
  return filterIndicators(readStore().map(normalizeIndicator), params);
}

export async function getIndicatorDetail(indicatorId: string): Promise<MockIndicatorItem> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}`);
    return normalizeDetail(payload);
  }
  const item = readStore().find((indicator) => indicator.id === indicatorId);
  if (!item) throw new Error(`Indicator not found: ${indicatorId}`);
  return normalizeIndicator(clone(item));
}

export async function getIndicatorPathTree(params: Record<string, unknown> = {}): Promise<unknown[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/indicator-path/tree', { params });
    return normalizePathTree(payload);
  }
  return clone(INDICATOR_PATH_OPTIONS) as unknown[];
}

export async function createIndicator(payload: MockIndicatorItem): Promise<MockIndicatorItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote('/indicators', { method: 'POST', body: payload });
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

export async function updateIndicator(indicatorId: string, payload: MockIndicatorItem): Promise<MockIndicatorItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}`, {
      method: 'PUT',
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

export async function deleteIndicator(indicatorId: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}`, { method: 'DELETE' });
    return;
  }
  writeStore(readStore().filter((item) => item.id !== indicatorId));
}

export async function updateIndicatorStatus(indicatorId: string, status: string): Promise<MockIndicatorItem> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/indicators/${encodeURIComponent(indicatorId)}/status`, {
      method: 'PATCH',
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
