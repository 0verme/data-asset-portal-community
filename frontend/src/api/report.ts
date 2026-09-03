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
import { REPORTS, type MockReportItem } from '../data/reports.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

let mockReports: MockReportItem[] = clone(REPORTS as MockReportItem[]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeCollection(payload: unknown, fallbackKey?: string): MockReportItem[] {
  if (Array.isArray(payload)) return payload as MockReportItem[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as MockReportItem[];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as MockReportItem[];
  return [];
}

function normalizeDetail(payload: unknown): MockReportItem {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const detail = record['data'] && typeof record['data'] === 'object' ? record['data'] : payload;
    return clone(detail) as MockReportItem;
  }
  throw new Error('Invalid report payload');
}

function readStore(): MockReportItem[] {
  return clone(mockReports);
}

function writeStore(items: MockReportItem[]): void {
  mockReports = clone(items);
}

export interface ReportQueryParams {
  type?: string | undefined;
  domain?: string | undefined;
  status?: string | undefined;
  ownerDept?: string | undefined;
  keyword?: string | undefined;
  [key: string]: unknown;
}

function filterReports(items: readonly MockReportItem[], params: ReportQueryParams = {}): MockReportItem[] {
  const keyword = String(params.keyword || '').trim().toLowerCase();
  return items.filter((item) => {
    if (params.type && item.type !== params.type) return false;
    if (params.domain && item.domain !== params.domain) return false;
    if (params.status && item.status !== params.status) return false;
    if (params.ownerDept && item.ownerDept !== params.ownerDept) return false;
    if (!keyword) return true;
    return [
      item.code,
      item.name,
      item.alias,
      item.ownerName,
      item.ownerDept,
      item.domain,
      item.purpose,
    ].some((value) => String(value || '').toLowerCase().includes(keyword));
  });
}

export async function getReportList(params: ReportQueryParams = {}): Promise<MockReportItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/reports', { params });
    return normalizeCollection(payload, 'items');
  }
  return filterReports(readStore(), params);
}

export async function getReportDetail(reportCode: string): Promise<MockReportItem> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/reports/${encodeURIComponent(reportCode)}`);
    return normalizeDetail(payload);
  }
  const item = readStore().find((report) => report.code === reportCode);
  if (!item) throw new Error(`Report not found: ${reportCode}`);
  return clone(item);
}

export async function createReport(payload: MockReportItem): Promise<MockReportItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote('/reports', { method: 'POST', body: payload });
    return normalizeDetail(response);
  }
  const items = readStore();
  if (items.some((item) => item.code === payload.code)) {
    throw new Error(`Report already exists: ${payload.code}`);
  }
  const nextItem: MockReportItem = {
    ...clone(payload),
    updatedBy: 'system',
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  writeStore([nextItem, ...items]);
  return clone(nextItem);
}

export async function updateReport(reportCode: string, payload: MockReportItem): Promise<MockReportItem> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/reports/${encodeURIComponent(reportCode)}`, {
      method: 'PUT',
      body: payload,
    });
    return normalizeDetail(response);
  }
  const items = readStore();
  const current = items.find((item) => item.code === reportCode);
  if (!current) throw new Error(`Report not found: ${reportCode}`);
  if (payload.code !== reportCode && items.some((item) => item.code === payload.code)) {
    throw new Error(`Report already exists: ${payload.code}`);
  }
  const nextItem: MockReportItem = {
    ...clone(payload),
    updatedBy: 'system',
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  writeStore([nextItem, ...items.filter((item) => item.code !== reportCode && item.code !== payload.code)]);
  return clone(nextItem);
}

export async function deleteReport(reportCode: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/reports/${encodeURIComponent(reportCode)}`, { method: 'DELETE' });
    return;
  }
  writeStore(readStore().filter((item) => item.code !== reportCode));
}
