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

import { DWM_TABLES, type MockDwmTable, type TableField } from '../data/tables.ts';
import { DOMAIN_ORDER, LAYER_OPTIONS, type LayerOption } from '../config/assets.ts';
import { LONG_REQUEST_TIMEOUT } from '../config/request.ts';
import { normalizeAssetDataTypes, normalizeFieldList } from '../constants/dataTypes.ts';
import { getAssetLayerValue, normalizeAssetLayerFields } from '../utils/assetFilters.ts';
import { generateDDLByDialect, getDDLDialectLabel, normalizeDDLResponse, type DDLNormalizedResult } from '../utils/ddlDialect.ts';
import { requestRemote } from './http.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function buildLayerVariantName(name: string, layerCode: string): string {
  const nextPrefix = `${String(layerCode || '').trim().toLowerCase()}_`;
  if (/^[a-z]+_/.test(name)) {
    return name.replace(/^[a-z]+_/, nextPrefix);
  }
  return `${nextPrefix}${name}`;
}

export interface AssetTableField extends TableField {
  fieldId?: number | null | undefined;
  assetId?: number | null | undefined;
}

export interface AssetTableItem {
  name: string;
  cn: string;
  domain: string;
  layer: string;
  owner: string;
  grain: string;
  cycle: string;
  desc: string;
  assetId?: number | null | undefined;
  tier?: string | undefined;
  schemaLayer?: string | undefined;
  dataLayer?: string | undefined;
  schema?: string | undefined;
  fields: AssetTableField[];
  fieldCount?: number | undefined;
  _fieldMatch?: string | null | undefined;
  [key: string]: unknown;
}

function createLayerVariants(tables: readonly MockDwmTable[], layerCode: string): AssetTableItem[] {
  return tables.map((table) => ({
    ...clone(table),
    name: buildLayerVariantName(table.name, layerCode),
    layer: layerCode,
    tier: layerCode,
    schemaLayer: layerCode,
    dataLayer: layerCode,
    schema: `DWS_${layerCode}`,
    fields: clone(table.fields) as AssetTableField[],
  }));
}

const MOCK_TABLES: AssetTableItem[] = [
  ...DWM_TABLES.map((t) => ({ ...clone(t), fields: clone(t.fields) as AssetTableField[] })),
  ...LAYER_OPTIONS
    .filter((layer) => layer.code !== 'DWM')
    .flatMap((layer) => createLayerVariants(DWM_TABLES, layer.code)),
];

// Mock mode has no database-issued identity, so assign deterministic local
// IDs solely to exercise the same selector contract as remote mode.
const MOCK_ASSET_IDS = new Map<string, number>(MOCK_TABLES.map((table, index) => [table.name, index + 1]));
const MOCK_FIELD_IDS = new Map<string, number>();
let nextMockFieldId = 1;
MOCK_TABLES.forEach((table) => {
  (table.fields || []).forEach((field) => {
    MOCK_FIELD_IDS.set(`${table.name}:${field.name}`, nextMockFieldId);
    nextMockFieldId += 1;
  });
});

interface MockOverridesState {
  upserts: Record<string, AssetTableItem>;
  deletedNames: string[];
}

let mockOverrides: MockOverridesState = { upserts: {}, deletedNames: [] };

function readOverrides(): MockOverridesState {
  return {
    upserts:
      mockOverrides && typeof mockOverrides.upserts === 'object' && mockOverrides.upserts
        ? clone(mockOverrides.upserts)
        : {},
    deletedNames: Array.isArray(mockOverrides?.deletedNames) ? [...mockOverrides.deletedNames] : [],
  };
}

function writeOverrides(overrides: MockOverridesState): void {
  mockOverrides = {
    upserts: clone(overrides?.upserts || {}),
    deletedNames: Array.isArray(overrides?.deletedNames) ? [...overrides.deletedNames] : [],
  };
}

function applyOverrides(tables: AssetTableItem[]): AssetTableItem[] {
  const { upserts, deletedNames } = readOverrides();
  const deletedSet = new Set(deletedNames);
  const merged = tables
    .filter((table) => !deletedSet.has(table.name))
    .map((table) => clone(upserts[table.name] || table));

  Object.values(upserts).forEach((table) => {
    if (!table || deletedSet.has(table.name)) return;
    if (merged.some((item) => item.name === table.name)) return;
    merged.unshift(clone(table));
  });

  return merged;
}

function normalizeTable(table: unknown): AssetTableItem {
  const rawTable = clone(table) as Record<string, unknown>;
  const normalized = normalizeAssetLayerFields(normalizeAssetDataTypes(rawTable)) as AssetTableItem;
  if (!normalized || typeof normalized !== 'object') return normalized;

  const rawAssetId = normalized['assetId'] ?? normalized['asset_id'];
  const assetId = typeof rawAssetId === 'number'
    ? rawAssetId
    : (API_MODE === 'mock' ? MOCK_ASSET_IDS.get(normalized.name) : null);

  const fields = (Array.isArray(normalized.fields) ? normalized.fields : []).map((f: unknown) => {
    const field = f as Record<string, unknown>;
    const rawFieldId = field['fieldId'] ?? field['field_id'];
    const fieldId = typeof rawFieldId === 'number'
      ? rawFieldId
      : (API_MODE === 'mock' ? MOCK_FIELD_IDS.get(`${normalized.name}:${String(field['name'] || '')}`) : null);

    const rawFieldAssetId = field['assetId'] ?? field['asset_id'];
    const fieldAssetId = typeof rawFieldAssetId === 'number' ? rawFieldAssetId : (assetId || null);

    return {
      ...field,
      fieldId: fieldId || null,
      assetId: fieldAssetId,
    } as AssetTableField;
  });

  return {
    ...normalized,
    assetId: assetId || null,
    fields,
  };
}

function normalizeTableCollection(tables: unknown): AssetTableItem[] {
  return Array.isArray(tables) ? tables.map(normalizeTable) : [];
}

export interface AssetQueryParams {
  layer?: string | undefined;
  domain?: string | undefined;
  keyword?: string | undefined;
  page?: number | string | undefined;
  pageSize?: number | string | undefined;
  summary?: boolean | undefined;
  [key: string]: unknown;
}

function getMockTables(params: AssetQueryParams = {}): AssetTableItem[] {
  const { layer, domain } = params;
  const normalizedLayer = typeof layer === 'string' ? layer.trim().toUpperCase() : '';

  return MOCK_TABLES.filter((table) => {
    const tableLayer = getAssetLayerValue(table as Record<string, unknown>);
    if (normalizedLayer && tableLayer !== normalizedLayer) return false;
    if (domain && table.domain !== domain) return false;
    return true;
  });
}

async function getMockAssetTables(params: AssetQueryParams = {}): Promise<AssetTableItem[]> {
  return normalizeTableCollection(applyOverrides(clone(getMockTables(params))));
}

async function getMockAssetDetail(tableName: string): Promise<AssetTableItem> {
  const table = normalizeTableCollection(applyOverrides(clone(getMockTables()))).find((item) => item.name === tableName);
  if (!table) {
    throw new Error(`未找到数据表: ${tableName}`);
  }
  return table;
}

async function getMockAssetFields(tableName: string): Promise<TableField[]> {
  const detail = await getMockAssetDetail(tableName);
  return normalizeFieldList(clone(detail.fields)) as TableField[];
}

async function getMockAssetDDL(tableName: string): Promise<DDLNormalizedResult> {
  const table = await getMockAssetDetail(tableName);
  const ddlDialect = 'postgresql';
  return {
    ddl: generateDDLByDialect(table, ddlDialect),
    ddlDialect,
    ddlDialectLabel: getDDLDialectLabel(ddlDialect, { mock: true }),
  };
}

export interface DomainCountItem {
  name: string;
  count: number;
}

async function getMockDomains({ layer }: { layer?: string | undefined } = {}): Promise<DomainCountItem[]> {
  const counts = applyOverrides(getMockTables())
    .filter((table) => !layer || getAssetLayerValue(table as Record<string, unknown>) === layer)
    .reduce<Record<string, number>>((acc, table) => {
      acc[table.domain] = (acc[table.domain] || 0) + 1;
      return acc;
    }, {});

  return DOMAIN_ORDER.filter((name) => counts[name]).map((name) => ({
    name,
    count: counts[name] || 0,
  }));
}

export interface LayerCountItem extends LayerOption {
  count: number;
}

async function getMockLayers({ domain }: { domain?: string | undefined } = {}): Promise<LayerCountItem[]> {
  const counts = applyOverrides(getMockTables())
    .filter((table) => !domain || table.domain === domain)
    .reduce<Record<string, number>>((acc, table) => {
      const layer = getAssetLayerValue(table as Record<string, unknown>);
      if (!layer) return acc;
      acc[layer] = (acc[layer] || 0) + 1;
      return acc;
    }, {});

  return LAYER_OPTIONS.map((layer) => ({
    ...layer,
    count: counts[layer.code] || 0,
  }));
}

function normalizeCollection<T = Record<string, unknown>>(payload: unknown, fallbackKey?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as T[];
  if (record && Array.isArray(record['data'])) return record['data'] as T[];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as T[];
  return [];
}

function normalizeDetail(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' && !Array.isArray(record['data'])
      ? (record['data'] as Record<string, unknown>)
      : record);
  }

  throw new Error('接口返回的表详情格式不正确。');
}

export async function getAssetTables(params: AssetQueryParams = {}): Promise<AssetTableItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/assets/tables', { params });
    return normalizeTableCollection(normalizeCollection(payload, 'tables'));
  }

  return getMockAssetTables(params);
}

export interface AssetTablePageResult {
  items: AssetTableItem[];
  page: number;
  pageSize: number;
  total: number;
}

export async function getAssetTablePage(params: AssetQueryParams = {}): Promise<AssetTablePageResult> {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || 20);
  if (API_MODE === 'remote') {
    const payload = await requestRemote<Record<string, unknown>>('/assets/tables', {
      params: { ...params, page, pageSize, summary: true },
    });
    return {
      items: normalizeTableCollection(normalizeCollection(payload, 'tables')),
      page: Number(payload?.['page']) || page,
      pageSize: Number(payload?.['pageSize']) || pageSize,
      total: Number(payload?.['total']) || 0,
    };
  }

  const keyword = String(params.keyword || '').trim().toLowerCase();
  const mockTables = await getMockAssetTables(params);
  const matches: AssetTableItem[] = [];
  for (const table of mockTables) {
    if (!keyword) {
      matches.push({ ...table, _fieldMatch: null });
      continue;
    }
    const nameHit = [table.name, table.cn, table.owner].some((value) =>
      String(value || '').toLowerCase().includes(keyword),
    );
    const fieldHit = table.fields.find((field) =>
      [field.name, field.cn].some((value) => String(value || '').toLowerCase().includes(keyword)),
    );
    if (nameHit || fieldHit) {
      matches.push({ ...table, _fieldMatch: fieldHit ? `${fieldHit.name} ${fieldHit.cn}` : null });
    }
  }

  const start = (page - 1) * pageSize;
  return {
    items: matches.slice(start, start + pageSize).map((table) => ({
      ...table,
      fieldCount: table.fields.length,
      fields: [],
    })),
    page,
    pageSize,
    total: matches.length,
  };
}

export async function getAssetDetail(tableName: string): Promise<AssetTableItem> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}`);
    return normalizeTable(normalizeDetail(payload));
  }

  return getMockAssetDetail(tableName);
}

export async function getAssetFields(tableName: string): Promise<TableField[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}/fields`);
    return normalizeFieldList(normalizeCollection(payload, 'fields')) as TableField[];
  }

  return getMockAssetFields(tableName);
}

export async function getAssetDDL(tableName: string): Promise<DDLNormalizedResult> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}/ddl`, {
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeDDLResponse(payload);
  }

  return getMockAssetDDL(tableName);
}

export async function getDomains(params: { layer?: string | undefined } = {}): Promise<DomainCountItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/assets/domains', { params });
    return normalizeCollection(payload, 'domains') as DomainCountItem[];
  }

  return getMockDomains(params);
}

export async function getLayers(params: { domain?: string | undefined } = {}): Promise<LayerCountItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/assets/layers', { params });
    return normalizeCollection(payload, 'layers') as LayerCountItem[];
  }

  return getMockLayers(params);
}

export async function saveAssetTable(table: unknown, oldName?: string): Promise<AssetTableItem> {
  const normalizedTable = normalizeTable(table);
  if (API_MODE === 'remote') {
    if (oldName) {
      const payload = await requestRemote(`/assets/tables/${encodeURIComponent(oldName)}`, {
        method: 'PUT',
        body: normalizedTable,
        timeout: LONG_REQUEST_TIMEOUT,
      });
      return normalizeTable(normalizeDetail(payload));
    }

    const payload = await requestRemote('/assets/tables', {
      method: 'POST',
      body: normalizedTable,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeTable(normalizeDetail(payload));
  }

  const overrides = readOverrides();
  const nextUpserts = { ...overrides.upserts };
  const nextDeleted = new Set(overrides.deletedNames);

  if (oldName && oldName !== normalizedTable.name) {
    delete nextUpserts[oldName];
    nextDeleted.add(oldName);
  }

  nextUpserts[normalizedTable.name] = normalizedTable;
  nextDeleted.delete(normalizedTable.name);

  writeOverrides({
    upserts: nextUpserts,
    deletedNames: [...nextDeleted],
  });

  return normalizeTable(normalizedTable);
}

export async function deleteAssetTable(tableName: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/assets/tables/${encodeURIComponent(tableName)}`, {
      method: 'DELETE',
    });
    return;
  }

  const overrides = readOverrides();
  const nextUpserts = { ...overrides.upserts };
  delete nextUpserts[tableName];

  const nextDeleted = new Set(overrides.deletedNames);
  nextDeleted.add(tableName);

  writeOverrides({
    upserts: nextUpserts,
    deletedNames: [...nextDeleted],
  });
}

export async function resetAssetOverrides(): Promise<void> {
  mockOverrides = { upserts: {}, deletedNames: [] };
}
