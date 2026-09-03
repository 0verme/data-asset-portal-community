/// <reference types="vite/client" />
import { requestRemote } from './http.ts';
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

interface ManualCodeTableListEnvelope {
  items?: MockManualCodeTable[] | undefined;
}

export async function getManualCodeTables(filters: ManualCodeTableFilterParams = {}): Promise<MockManualCodeTable[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote<ManualCodeTableListEnvelope>('/manual-code-tables', { params: filters });
    return Array.isArray(payload?.items) ? payload.items : [];
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
