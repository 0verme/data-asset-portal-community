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
import { FIELD_MAPPING_ROWS, type FieldMappingRow } from '../data/fieldMappings.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

export const FIELD_MAPPING_PAGE_SIZE_OPTIONS: readonly number[] = [50, 100, 150] as const;
export const FIELD_MAPPING_DEFAULT_PAGE_SIZE = FIELD_MAPPING_PAGE_SIZE_OPTIONS[0] ?? 50;

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

function normalizeCollection(payload: unknown, fallbackKey?: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as unknown[];
  return [];
}

function normalizeDetail(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return record['data'] && typeof record['data'] === 'object' && !Array.isArray(record['data'])
      ? (record['data'] as Record<string, unknown>)
      : record;
  }
  throw new Error('字段映射接口返回格式无效');
}

export interface PagedFieldMappingResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizePaged<T>(payload: unknown): PagedFieldMappingResult<T> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('字段映射分页接口返回格式无效');
  }
  const record = payload as Record<string, unknown>;
  return {
    items: normalizeCollection(payload, 'fields') as T[],
    total: Number(record['total'] || 0),
    page: Number(record['page'] || 1),
    pageSize: Number(record['pageSize'] || 0),
  };
}

function includesValue(value: unknown, query: string): boolean {
  return String(value || '').toLowerCase().includes(query);
}

function compareNullableText(left: unknown, right: unknown): number {
  const leftText = String(left || '').trim();
  const rightText = String(right || '').trim();
  const leftEmpty = leftText === '';
  const rightEmpty = rightText === '';

  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  return leftText.localeCompare(rightText, 'zh-CN');
}

function compareNullableNumber(left: unknown, right: unknown): number {
  const leftMissing = left === null || left === undefined || left === '';
  const rightMissing = right === null || right === undefined || right === '';

  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  return Number(left) - Number(right);
}

type Resolver<T> = (left: T, right: T) => number;

function compareByOrder<T>(left: T, right: T, resolvers: readonly Resolver<T>[]): number {
  for (const resolver of resolvers) {
    const result = resolver(left, right);
    if (result !== 0) return result;
  }
  return 0;
}

export interface EnrichedFieldMappingRow {
  sourceSystemId?: string | number | undefined;
  upstreamSystemId?: string | number | undefined;
  systemCode?: string | undefined;
  srcSystem?: string | undefined;
  srcTable?: string | undefined;
  srcTableCn?: string | undefined;
  loadMode?: string | undefined;
  srcField?: string | undefined;
  srcType?: string | undefined;
  srcComment?: string | undefined;
  targetLayer?: string | undefined;
  targetTable?: string | undefined;
  targetField?: string | undefined;
  mappingRule?: string | undefined;
  updatedAt?: string | undefined;
  fieldOrder?: number | null | undefined;
  columnId?: number | null | undefined;
  ordinalPosition?: number | null | undefined;
  sortOrder?: number | null | undefined;
  __mockIndex?: number | undefined;
  [key: string]: unknown;
}

function compareFieldRowsDefault(left: EnrichedFieldMappingRow, right: EnrichedFieldMappingRow): number {
  return compareByOrder(left, right, [
    (a, b) => compareNullableText(a.srcSystem, b.srcSystem),
    (a, b) => compareNullableText(a.srcTable, b.srcTable),
    (a, b) => compareNullableNumber(a.fieldOrder, b.fieldOrder),
    (a, b) => compareNullableText(a.srcField, b.srcField),
    (a, b) => compareNullableText(a.targetTable, b.targetTable),
    (a, b) => compareNullableText(a.targetField, b.targetField),
    (a, b) => compareNullableNumber(a.__mockIndex, b.__mockIndex),
  ]);
}

export interface FieldMappingTableSummary {
  __mockIndex: number;
  sourceSystemId: string | number;
  upstreamSystemId: string | number;
  systemCode: string;
  srcSystem: string;
  srcTable: string;
  srcTableCn: string;
  targetLayer: string;
  targetTable: string;
  loadMode: string;
  fieldCount: number;
  mappedCount: number;
  emptyCommentCount: number;
  emptyCommentRate: number;
  updatedAt: string;
}

function compareTableRowsDefault(
  left: { srcSystem?: unknown; srcTable?: unknown; targetTable?: unknown; __mockIndex?: unknown },
  right: { srcSystem?: unknown; srcTable?: unknown; targetTable?: unknown; __mockIndex?: unknown },
): number {
  return compareByOrder(left, right, [
    (a, b) => compareNullableText(a.srcSystem, b.srcSystem),
    (a, b) => compareNullableText(a.srcTable, b.srcTable),
    (a, b) => compareNullableText(a.targetTable, b.targetTable),
    (a, b) => compareNullableNumber(a.__mockIndex, b.__mockIndex),
  ]);
}

function compareFieldRowsBySort(
  left: EnrichedFieldMappingRow,
  right: EnrichedFieldMappingRow,
  sortKey: string,
  sortDirection: string,
): number {
  const direction = sortDirection === 'desc' ? -1 : 1;
  const primary = compareNullableText(left[sortKey], right[sortKey]) * direction;
  if (primary !== 0) return primary;
  return compareFieldRowsDefault(left, right);
}

function enrichRow(row: Partial<FieldMappingRow> & Record<string, unknown>): EnrichedFieldMappingRow {
  const rawSourceSystemId = row['sourceSystemId'] ?? row['upstreamSystemId'];
  const sourceSystemId = rawSourceSystemId !== undefined && rawSourceSystemId !== null ? rawSourceSystemId : '';
  const rawOrder = row['fieldOrder'] ?? row['columnId'] ?? row['ordinalPosition'] ?? row['sortOrder'];
  const fieldOrder = typeof rawOrder === 'number' ? rawOrder : null;
  return {
    ...row,
    fieldOrder,
    sourceSystemId: sourceSystemId as string | number,
    upstreamSystemId: (row['upstreamSystemId'] ?? sourceSystemId) as string | number,
  };
}

export interface FieldMappingQueryParams {
  keyword?: string | undefined;
  sourceSystemId?: string | number | undefined;
  upstreamSystemId?: string | number | undefined;
  srcSystem?: string | undefined;
  srcTable?: string | undefined;
  srcField?: string | undefined;
  emptyComment?: string | undefined;
  targetTable?: string | undefined;
  targetField?: string | undefined;
  sortKey?: string | undefined;
  sortDirection?: string | undefined;
  page?: number | string | undefined;
  pageSize?: number | string | undefined;
  limit?: number | string | undefined;
  [key: string]: unknown;
}

export function filterFieldMappingRows(
  rows: readonly EnrichedFieldMappingRow[],
  params: FieldMappingQueryParams = {},
): EnrichedFieldMappingRow[] {
  const keyword = String(params.keyword || '').trim().toLowerCase();
  const sourceSystemId = String(params.sourceSystemId || params.upstreamSystemId || '').trim();
  const srcSystem = String(params.srcSystem || '').trim();
  const srcTable = String(params.srcTable || '').trim().toLowerCase();
  const srcField = String(params.srcField || '').trim().toLowerCase();
  const emptyComment = String(params.emptyComment || '').trim();
  const targetTable = String(params.targetTable || '').trim().toLowerCase();
  const targetField = String(params.targetField || '').trim().toLowerCase();

  return rows.filter((row) => {
    if (sourceSystemId && String(row.sourceSystemId || row.upstreamSystemId || '') !== sourceSystemId) return false;
    if (srcSystem && row.srcSystem !== srcSystem) return false;
    if (srcTable && !includesValue(row.srcTable, srcTable)) return false;
    if (srcField && !includesValue(row.srcField, srcField)) return false;
    if (targetTable && !includesValue(row.targetTable, targetTable)) return false;
    if (targetField && !includesValue(row.targetField, targetField)) return false;
    if (emptyComment === 'yes' && String(row.srcComment || '').trim()) return false;
    if (emptyComment === 'no' && !String(row.srcComment || '').trim()) return false;
    if (!keyword) return true;
    return [
      row.srcSystem,
      row.srcTable,
      row.srcTableCn,
      row.srcField,
      row.srcType,
      row.srcComment,
      row.targetTable,
      row.targetField,
      row.mappingRule,
    ].some((value) => includesValue(value, keyword));
  });
}

function summarizeTables(rows: readonly EnrichedFieldMappingRow[]): FieldMappingTableSummary[] {
  const groups = new Map<string, Omit<FieldMappingTableSummary, 'emptyCommentRate'>>();

  rows.forEach((row) => {
    const rawSourceSystemId = row.sourceSystemId ?? row.upstreamSystemId;
    const sourceSystemId = rawSourceSystemId !== undefined && rawSourceSystemId !== null ? rawSourceSystemId : '';
    const key = `${sourceSystemId}::${String(row.srcTable || '')}`;
    const current = groups.get(key) || {
      __mockIndex: row.__mockIndex ?? 0,
      sourceSystemId,
      upstreamSystemId: row.upstreamSystemId ?? sourceSystemId,
      systemCode: String(row.systemCode || ''),
      srcSystem: String(row.srcSystem || ''),
      srcTable: String(row.srcTable || ''),
      srcTableCn: String(row.srcTableCn || ''),
      targetLayer: String(row.targetLayer || ''),
      targetTable: String(row.targetTable || ''),
      loadMode: String(row.loadMode || ''),
      fieldCount: 0,
      mappedCount: 0,
      emptyCommentCount: 0,
      updatedAt: String(row.updatedAt || ''),
    };
    current.fieldCount += 1;
    if (row.targetField) current.mappedCount += 1;
    if (!String(row.srcComment || '').trim()) current.emptyCommentCount += 1;
    if (String(row.updatedAt || '') > current.updatedAt) current.updatedAt = String(row.updatedAt || '');
    groups.set(key, current);
  });

  return [...groups.values()]
    .map((item) => ({
      ...item,
      emptyCommentRate: item.fieldCount ? Math.round((item.emptyCommentCount / item.fieldCount) * 100) : 0,
    }))
    .sort(compareTableRowsDefault);
}

export interface FieldMappingStats {
  sourceSystemCount: number;
  sourceTableCount: number;
  fieldCount: number;
  mappedFieldCount: number;
  unmappedFieldCount: number;
  emptyCommentCount: number;
  coverage: number;
}

function buildStats(rows: readonly EnrichedFieldMappingRow[]): FieldMappingStats {
  const tables = summarizeTables(rows);
  const mappedFields = rows.filter((row) => row.targetField).length;
  return {
    sourceSystemCount: new Set(
      rows
        .map((row) => row.sourceSystemId ?? row.upstreamSystemId)
        .filter((value) => value !== undefined && value !== null && value !== ''),
    ).size,
    sourceTableCount: tables.length,
    fieldCount: rows.length,
    mappedFieldCount: mappedFields,
    unmappedFieldCount: rows.length - mappedFields,
    emptyCommentCount: rows.filter((row) => !String(row.srcComment || '').trim()).length,
    coverage: rows.length ? Math.round((mappedFields / rows.length) * 100) : 0,
  };
}

function getMockRows(params: FieldMappingQueryParams = {}): EnrichedFieldMappingRow[] {
  const sortKey = String(params.sortKey || '').trim();
  const sortDirection = String(params.sortDirection || '').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const rows = filterFieldMappingRows(
    clone(FIELD_MAPPING_ROWS).map((row, index) => enrichRow({ ...row, __mockIndex: index })),
    params,
  );

  rows.sort((left, right) => {
    if (sortKey) return compareFieldRowsBySort(left, right, sortKey, sortDirection);
    return compareFieldRowsDefault(left, right);
  });
  return rows;
}

export interface FieldMappingSourceSystemOption {
  id: string | number;
  sourceSystemId: string | number;
  upstreamSystemId: string | number;
  name: string;
  systemName: string;
  systemCode: string;
  systemAbbr: string;
  count: number;
}

export async function getFieldMappingSourceSystems(): Promise<FieldMappingSourceSystemOption[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/field-mappings/source-systems');
    return normalizeCollection(payload, 'systems') as FieldMappingSourceSystemOption[];
  }

  const counts = FIELD_MAPPING_ROWS.reduce<Record<string, FieldMappingSourceSystemOption>>((acc, row) => {
    const rawSourceSystemId = row.sourceSystemId ?? row.upstreamSystemId;
    const sourceSystemId = rawSourceSystemId !== undefined && rawSourceSystemId !== null ? rawSourceSystemId : '';
    const key = String(sourceSystemId);
    const current = acc[key] || {
      id: sourceSystemId,
      sourceSystemId,
      upstreamSystemId: row.upstreamSystemId ?? sourceSystemId,
      name: row.srcSystem,
      systemName: row.srcSystem,
      systemCode: row.systemCode || '',
      systemAbbr: row.systemCode || '',
      count: 0,
    };
    current.count += 1;
    acc[key] = current;
    return acc;
  }, {});

  return Object.values(counts)
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
      || String(left.systemCode || '').localeCompare(String(right.systemCode || ''), 'zh-CN')
      || Number(left.id || 0) - Number(right.id || 0));
}

export async function getFieldMappingStats(params: FieldMappingQueryParams = {}): Promise<FieldMappingStats> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/field-mappings/stats', {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    const detail = normalizeDetail(payload);
    return {
      sourceSystemCount: Number(detail['sourceSystemCount'] || 0),
      sourceTableCount: Number(detail['sourceTableCount'] || 0),
      fieldCount: Number(detail['fieldCount'] || 0),
      mappedFieldCount: Number(detail['mappedFieldCount'] || 0),
      unmappedFieldCount: Number(detail['unmappedFieldCount'] || 0),
      emptyCommentCount: Number(detail['emptyCommentCount'] || 0),
      coverage: Number(detail['coverage'] || 0),
    };
  }
  return buildStats(getMockRows(params));
}

export async function getFieldMappings(
  params: FieldMappingQueryParams = {},
): Promise<PagedFieldMappingResult<EnrichedFieldMappingRow>> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/field-mappings/fields', {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizePaged<EnrichedFieldMappingRow>(payload);
  }
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Number(params.pageSize || params.limit || FIELD_MAPPING_DEFAULT_PAGE_SIZE));
  const rows = getMockRows(params);
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

export async function getFieldMappingTables(
  params: FieldMappingQueryParams = {},
): Promise<PagedFieldMappingResult<FieldMappingTableSummary>> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/field-mappings/tables', {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizePaged<FieldMappingTableSummary>(payload);
  }
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Number(params.pageSize || params.limit || FIELD_MAPPING_DEFAULT_PAGE_SIZE));
  const rows = summarizeTables(getMockRows(params));
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}
