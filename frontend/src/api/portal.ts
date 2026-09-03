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
import { getMenus } from './menus.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

export interface PortalStatItem {
  label: string;
  value: string;
}

interface MockPortalStatConfig extends PortalStatItem {
  moduleKey?: string | undefined;
}

const MOCK_PORTAL_STATS: readonly MockPortalStatConfig[] = [
  { label: '源系统', value: '8', moduleKey: 'upstream' },
  { label: '源表', value: '12', moduleKey: 'mapping' },
  { label: '字段', value: '72', moduleKey: 'mapping' },
  { label: '指标', value: '36', moduleKey: 'indicator' },
  { label: '下游系统', value: '6', moduleKey: 'push' },
  { label: '下游推送', value: '6', moduleKey: 'push' },
  { label: '主题域', value: '8', moduleKey: 'dwm' },
  { label: '主题表', value: '224', moduleKey: 'dwm' },
  { label: '报表', value: '8', moduleKey: 'report' },
  { label: 'API', value: '10', moduleKey: 'apiAsset' },
  { label: '词根', value: '40', moduleKey: 'root' },
] as const;

function normalizeStats(payload: unknown): PortalStatItem[] {
  const record = payload as Record<string, unknown> | null | undefined;
  const rows = Array.isArray(payload)
    ? (payload as Array<Record<string, unknown>>)
    : record && Array.isArray(record['items'])
      ? (record['items'] as Array<Record<string, unknown>>)
      : record && Array.isArray(record['stats'])
        ? (record['stats'] as Array<Record<string, unknown>>)
        : [];
  return rows
    .filter((row) => row && row['label'] != null)
    .map((row) => ({ label: String(row['label']), value: String(row['value'] ?? '-') }));
}

export async function getPortalStats(): Promise<PortalStatItem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/portal/stats');
    return normalizeStats(payload);
  }

  const menus = await getMenus();
  const enabledMenuCodes = new Set(
    (Array.isArray(menus) ? menus : [])
      .filter((item) => item?.status !== 'disabled')
      .map((item) => String(item.code || '').trim())
      .filter(Boolean),
  );
  return MOCK_PORTAL_STATS
    .filter((row) => !row.moduleKey || enabledMenuCodes.has(row.moduleKey))
    .map(({ moduleKey: _moduleKey, ...row }) => ({ ...row }));
}
