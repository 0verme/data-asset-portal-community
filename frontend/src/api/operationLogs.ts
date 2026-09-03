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
import { OPERATION_LOGS, type MockOperationLogItem } from '../data/operationLogs.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface OperationLogListResult {
  items: MockOperationLogItem[];
  total: number;
}

function normalizeList(payload: unknown): OperationLogListResult {
  if (Array.isArray(payload)) return { items: payload as MockOperationLogItem[], total: payload.length };
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) {
    const items = record['items'] as MockOperationLogItem[];
    const total = Number(record['total'] ?? items.length);
    return { items, total };
  }
  return { items: [], total: 0 };
}

function normalizeDetail(payload: unknown): MockOperationLogItem {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as MockOperationLogItem;
  }
  throw new Error('Invalid operation log payload');
}

export interface OperationLogFilterParams {
  keyword?: string | undefined;
  module?: string | undefined;
  operationType?: string | undefined;
  result?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  page?: number | string | undefined;
  pageSize?: number | string | undefined;
  [key: string]: unknown;
}

function matchesFilter(log: MockOperationLogItem, filter: OperationLogFilterParams): boolean {
  const keyword = (filter.keyword || '').trim().toLowerCase();
  if (filter.module && log.moduleName !== filter.module) return false;
  if (filter.operationType && log.operationType !== filter.operationType) return false;
  if (filter.result && filter.result !== 'all' && log.resultStatus !== filter.result) return false;
  if (filter.startTime && log.createdAt < filter.startTime) return false;
  if (filter.endTime && log.createdAt > filter.endTime) return false;
  if (keyword) {
    const hit = [log.userName, log.moduleName, log.operationObject, log.operationDesc].some((value) =>
      String(value || '').toLowerCase().includes(keyword),
    );
    if (!hit) return false;
  }
  return true;
}

/**
 * 获取操作日志列表。
 */
export async function getOperationLogList(filter: OperationLogFilterParams = {}): Promise<OperationLogListResult> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/operation-logs', {
      params: {
        keyword: filter.keyword,
        module: filter.module,
        operationType: filter.operationType,
        result: filter.result && filter.result !== 'all' ? filter.result : undefined,
        startTime: filter.startTime,
        endTime: filter.endTime,
        page: filter.page,
        pageSize: filter.pageSize,
      },
    });
    return normalizeList(payload);
  }

  const all = clone(OPERATION_LOGS)
    .filter((log) => matchesFilter(log, filter))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = all.length;
  const page = Number(filter.page) > 0 ? Number(filter.page) : 1;
  const pageSize = Number(filter.pageSize) > 0 ? Number(filter.pageSize) : total || 1;
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total };
}

/**
 * 获取单条操作日志详情。
 */
export async function getOperationLogDetail(id: number | string): Promise<MockOperationLogItem> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/operation-logs/${encodeURIComponent(id)}`);
    return normalizeDetail(payload);
  }

  const log = OPERATION_LOGS.find((item) => String(item.id) === String(id));
  if (!log) throw new Error(`Operation log not found: ${id}`);
  return clone(log);
}

/**
 * 导出操作日志（预留）。
 */
export async function exportOperationLog(filter: OperationLogFilterParams = {}): Promise<unknown> {
  if (API_MODE === 'remote') {
    return requestRemote('/operation-logs/export', {
      params: {
        keyword: filter.keyword,
        module: filter.module,
        operationType: filter.operationType,
        result: filter.result && filter.result !== 'all' ? filter.result : undefined,
        startTime: filter.startTime,
        endTime: filter.endTime,
      },
      timeout: LONG_REQUEST_TIMEOUT,
    });
  }
  // Mock 模式下暂不实现真实导出
  return Promise.resolve({ success: true, message: 'Mock 模式：导出请求已收到。' });
}
