/// <reference types="vite/client" />
import { requestRemote } from './http.ts';
import { parseCollectionResponse } from './collectionResponse.ts';
import { MANUAL_CODE_TABLES, type MockManualCodeTable } from '../data/manualCodeTables.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

let mockItems: MockManualCodeTable[] = structuredClone(MANUAL_CODE_TABLES as MockManualCodeTable[]);

const clone = <T>(value: T): T => structuredClone(value);
const nowText = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');

function detail<T>(payload: unknown): T {
  const record = payload as Record<string, unknown> | null | undefined;
  return (record?.['data'] ? record['data'] : payload) as T;
}

const MANUAL_CODE_TABLE_STATUS_VALUES: ReadonlySet<string> = new Set(['enabled', 'disabled']);

export interface ManualCodeTablePayload extends Omit<MockManualCodeTable, 'id' | 'updatedAt'> {
  id?: string | undefined;
  updatedAt?: string | undefined;
}

function normalizeManualCodeTablePayload(payload: ManualCodeTablePayload): ManualCodeTablePayload {
  const normalized = { ...clone(payload), status: String(payload?.status || 'enabled').trim().toLowerCase() };
  if (!MANUAL_CODE_TABLE_STATUS_VALUES.has(normalized.status)) {
    throw new Error('码值表状态仅支持启用或禁用');
  }
  return normalized;
}

function normalizeManualCodeTableStatus(status: unknown): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (!MANUAL_CODE_TABLE_STATUS_VALUES.has(normalized)) {
    throw new Error('码值表状态仅支持启用或禁用');
  }
  return normalized;
}

export interface ManualCodeTableFilterParams {
  keyword?: string | undefined;
  style?: string | undefined;
  status?: string | undefined;
  [key: string]: unknown;
}

export interface ManualCodeTableFacets {
  styleTotal: number;
  styles: Record<string, number>;
  statusTotal: number;
  statuses: { enabled: number; disabled: number };
}

export interface ManualCodeTablePage {
  items: MockManualCodeTable[];
  total: number;
  page: number;
  pageSize: number;
  stats: { total: number; enabled: number; disabled: number; styleCount: number };
  facets: ManualCodeTableFacets;
}

export function normalizeCollection(payload: unknown): MockManualCodeTable[] {
  return parseCollectionResponse<MockManualCodeTable>(payload, '码值表列表');
}

export async function exportManualCodeTablesCsv(
  filters: ManualCodeTableFilterParams = {},
): Promise<string | null> {
  if (API_MODE !== 'remote') return null;
  const payload = await requestRemote<unknown>('/manual-code-tables/export', { params: filters });
  if (typeof payload !== 'string') throw new Error('码值表导出接口返回格式无效');
  return payload;
}

export async function getManualCodeTablePage(
  filters: ManualCodeTableFilterParams = {},
  page = 1,
  pageSize = 20,
): Promise<ManualCodeTablePage> {
  const normalizedPageSize = Math.max(1, Number(pageSize) || 20);
  const normalizedPage = Math.max(1, Number(page) || 1);
  if (API_MODE === 'remote') {
    const payload = await requestRemote<unknown>('/manual-code-tables/page', {
      params: { ...filters, page: normalizedPage, pageSize: normalizedPageSize },
    });
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('码值表分页接口返回格式无效');
    const record = payload as Record<string, unknown>;
    const stats = record['stats'];
    const facets = record['facets'];
    if (!Array.isArray(record['items']) || !Number.isSafeInteger(record['total']) || Number(record['total']) < 0 ||
      !Number.isSafeInteger(record['page']) || Number(record['page']) < 1 ||
      !Number.isSafeInteger(record['pageSize']) || Number(record['pageSize']) < 1 ||
      !stats || typeof stats !== 'object' || Array.isArray(stats) ||
      !facets || typeof facets !== 'object' || Array.isArray(facets)) throw new Error('码值表分页接口返回格式无效');
    const statRecord = stats as Record<string, unknown>;
    const facetRecord = facets as Record<string, unknown>;
    const statusCounts = facetRecord['statuses'];
    const styleCounts = facetRecord['styles'];
    const statKeys = ['total', 'enabled', 'disabled', 'styleCount'] as const;
    for (const key of statKeys) {
      if (!Number.isSafeInteger(statRecord[key]) || Number(statRecord[key]) < 0) throw new Error('码值表统计接口返回格式无效');
    }
    if (!Number.isSafeInteger(facetRecord['styleTotal']) || Number(facetRecord['styleTotal']) < 0 ||
      !Number.isSafeInteger(facetRecord['statusTotal']) || Number(facetRecord['statusTotal']) < 0 ||
      !styleCounts || typeof styleCounts !== 'object' || Array.isArray(styleCounts) ||
      !statusCounts || typeof statusCounts !== 'object' || Array.isArray(statusCounts)) throw new Error('码值表筛选统计返回格式无效');
    const styles: Record<string, number> = {};
    for (const [key, value] of Object.entries(styleCounts as Record<string, unknown>)) {
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('码值表筛选统计返回格式无效');
      styles[key] = Number(value);
    }
    const statusRecord = statusCounts as Record<string, unknown>;
    for (const key of ['enabled', 'disabled'] as const) {
      if (!Number.isSafeInteger(statusRecord[key]) || Number(statusRecord[key]) < 0) throw new Error('码值表筛选统计返回格式无效');
    }
    return {
      items: normalizeCollection(record['items']),
      total: Number(record['total']),
      page: Number(record['page']),
      pageSize: Number(record['pageSize']),
      stats: {
        total: Number(statRecord['total']),
        enabled: Number(statRecord['enabled']),
        disabled: Number(statRecord['disabled']),
        styleCount: Number(statRecord['styleCount']),
      },
      facets: {
        styleTotal: Number(facetRecord['styleTotal']),
        styles,
        statusTotal: Number(facetRecord['statusTotal']),
        statuses: { enabled: Number(statusRecord['enabled']), disabled: Number(statusRecord['disabled']) },
      },
    };
  }
  const all = await getManualCodeTables(filters);
  all.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.tableCode.localeCompare(right.tableCode) || left.id.localeCompare(right.id));
  const lastPage = Math.max(1, Math.ceil(all.length / normalizedPageSize));
  const currentPage = Math.min(normalizedPage, lastPage);
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const queryItems = mockItems.filter((item) => !keyword ||
    [item.tableCode, item.tableName, item.owner, item.remark].some((value) => String(value || '').toLowerCase().includes(keyword)));
  const styleFacetItems = queryItems.filter((item) => !filters.status || item.status === filters.status);
  const statusFacetItems = queryItems.filter((item) => !filters.style || item.style === filters.style);
  const styleValues = [...new Set(['enum', 'dim', 'status', 'map', 'custom', ...mockItems.map((item) => item.style)])];
  return {
    items: all.slice((currentPage - 1) * normalizedPageSize, currentPage * normalizedPageSize),
    total: all.length,
    page: currentPage,
    pageSize: normalizedPageSize,
    stats: {
      total: mockItems.length,
      enabled: mockItems.filter((item) => item.status === 'enabled').length,
      disabled: mockItems.filter((item) => item.status === 'disabled').length,
      styleCount: new Set(mockItems.map((item) => item.style)).size,
    },
    facets: {
      styleTotal: styleFacetItems.length,
      styles: Object.fromEntries(styleValues.map((style) => [style, styleFacetItems.filter((item) => item.style === style).length])),
      statusTotal: statusFacetItems.length,
      statuses: {
        enabled: statusFacetItems.filter((item) => item.status === 'enabled').length,
        disabled: statusFacetItems.filter((item) => item.status === 'disabled').length,
      },
    },
  };
}

export async function getManualCodeTables(filters: ManualCodeTableFilterParams = {}): Promise<MockManualCodeTable[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote<unknown>('/manual-code-tables', { params: filters });
    return normalizeCollection(payload);
  }
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  return clone(
    mockItems.filter((item) => {
      if (filters.style && item.style !== filters.style) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (!keyword) return true;
      return [item.tableCode, item.tableName, item.owner, item.remark].some((value) =>
        String(value || '').toLowerCase().includes(keyword),
      );
    }),
  );
}

export async function createManualCodeTable(payload: ManualCodeTablePayload): Promise<MockManualCodeTable> {
  const normalizedPayload = normalizeManualCodeTablePayload(payload);
  if (API_MODE === 'remote') {
    return detail<MockManualCodeTable>(
      await requestRemote('/manual-code-tables', { method: 'POST', body: normalizedPayload }),
    );
  }
  if (mockItems.some((item) => item.tableCode === normalizedPayload.tableCode)) {
    throw new Error(`码表编码已存在：${normalizedPayload.tableCode}`);
  }
  const id = String(Math.max(0, ...mockItems.map((item) => Number(item.id) || 0)) + 1);
  const item: MockManualCodeTable = {
    id,
    tableCode: normalizedPayload.tableCode,
    tableName: normalizedPayload.tableName,
    style: normalizedPayload.style,
    owner: normalizedPayload.owner,
    status: normalizedPayload.status,
    remark: normalizedPayload.remark,
    updatedAt: nowText(),
  };
  mockItems.unshift(item);
  return clone(item);
}

export async function updateManualCodeTable(
  id: string,
  payload: ManualCodeTablePayload,
): Promise<MockManualCodeTable> {
  const normalizedPayload = normalizeManualCodeTablePayload(payload);
  if (API_MODE === 'remote') {
    return detail<MockManualCodeTable>(
      await requestRemote(`/manual-code-tables/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: normalizedPayload,
      }),
    );
  }
  if (mockItems.some((item) => item.id !== id && item.tableCode === normalizedPayload.tableCode)) {
    throw new Error(`码表编码已存在：${normalizedPayload.tableCode}`);
  }
  const current = mockItems.find((item) => item.id === id);
  if (!current) throw new Error(`码表不存在：${id}`);
  const item: MockManualCodeTable = {
    ...current,
    ...normalizedPayload,
    id: current.id,
    updatedAt: nowText(),
  };
  mockItems = mockItems.map((row) => (row.id === id ? item : row));
  return clone(item);
}

export async function updateManualCodeTableStatus(id: string, status: unknown): Promise<MockManualCodeTable> {
  const normalizedStatus = normalizeManualCodeTableStatus(status);
  if (API_MODE === 'remote') {
    return detail<MockManualCodeTable>(
      await requestRemote(`/manual-code-tables/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: { status: normalizedStatus },
      }),
    );
  }
  const current = mockItems.find((item) => item.id === id);
  if (!current) throw new Error(`码表不存在：${id}`);
  const item: MockManualCodeTable = { ...current, status: normalizedStatus, updatedAt: nowText() };
  mockItems = mockItems.map((row) => (row.id === id ? item : row));
  return clone(item);
}

export async function deleteManualCodeTable(id: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/manual-code-tables/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return;
  }
  mockItems = mockItems.filter((item) => item.id !== id);
}
