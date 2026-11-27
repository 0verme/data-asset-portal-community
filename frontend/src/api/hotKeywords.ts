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
  PORTAL_AI_EXAMPLE_CATEGORY,
  type PortalHotKeyword,
} from '../config/portalSearch.ts';

export interface AdminPortalRecommendationItem {
  id: number;
  keyword: string;
  category: string;
  itemType: 'ai_example' | 'hot_keyword';
  sortOrder: number;
  enabled: 'Y' | 'N';
  status: 'enabled' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface AdminPortalRecommendationPayload {
  keyword: string;
  category: string;
  sortOrder: number;
  status: 'enabled' | 'disabled';
}

function parseAdminRecommendationItem(row: Record<string, unknown>): AdminPortalRecommendationItem {
  const category = String(row['category'] || 'all').trim() || 'all';
  const rawEnabled = String(row['enabled'] ?? (row['status'] === 'disabled' ? 'N' : 'Y')).trim().toUpperCase();
  const enabled: 'Y' | 'N' = rawEnabled === 'N' ? 'N' : 'Y';
  return {
    id: Number(row['id']),
    keyword: String(row['keyword'] || '').trim(),
    category,
    itemType: category === PORTAL_AI_EXAMPLE_CATEGORY ? 'ai_example' : 'hot_keyword',
    sortOrder: Number.isFinite(Number(row['sortOrder'])) ? Number(row['sortOrder']) : 0,
    enabled,
    status: enabled === 'Y' ? 'enabled' : 'disabled',
    createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : '',
    updatedAt: typeof row['updatedAt'] === 'string' ? row['updatedAt'] : '',
  };
}

/** Load administrator-configured recommendations; there is deliberately no mock fallback. */
export async function getHotKeywords(): Promise<PortalHotKeyword[]> {
  const payload = await requestRemote<{ items?: unknown }>('/search/hot-keywords', {
    suppressUnauthorizedEvent: true,
  });
  const rows = payload && Array.isArray(payload.items) ? payload.items : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .filter((row) => Number.isInteger(row['id']) && String(row['keyword'] || '').trim().length > 0)
    .map((row) => ({
      id: Number(row['id']),
      keyword: String(row['keyword']).trim(),
      category: String(row['category'] || 'all'),
      sortOrder: Number.isFinite(Number(row['sortOrder'])) ? Number(row['sortOrder']) : 0,
    }));
}

export async function getAdminPortalRecommendations(): Promise<AdminPortalRecommendationItem[]> {
  const payload = await requestRemote<{ items?: unknown }>('/system/search-hot-keywords');
  const rows = payload && Array.isArray(payload.items) ? payload.items : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .filter((row) => Number.isInteger(Number(row['id'])) && String(row['keyword'] || '').trim().length > 0)
    .map(parseAdminRecommendationItem);
}

export async function createAdminPortalRecommendation(
  input: AdminPortalRecommendationPayload,
): Promise<AdminPortalRecommendationItem> {
  const payload = await requestRemote<{ data?: unknown }>('/system/search-hot-keywords', {
    method: 'POST',
    body: {
      keyword: input.keyword,
      category: input.category,
      sortOrder: input.sortOrder,
      status: input.status,
    },
  });
  if (!payload || typeof payload.data !== 'object' || !payload.data) {
    throw new Error('创建推荐项响应格式无效');
  }
  return parseAdminRecommendationItem(payload.data as Record<string, unknown>);
}

export async function updateAdminPortalRecommendation(
  id: number,
  input: AdminPortalRecommendationPayload,
): Promise<AdminPortalRecommendationItem> {
  const payload = await requestRemote<{ data?: unknown }>(`/system/search-hot-keywords/${id}`, {
    method: 'PUT',
    body: {
      keyword: input.keyword,
      category: input.category,
      sortOrder: input.sortOrder,
      status: input.status,
    },
  });
  if (!payload || typeof payload.data !== 'object' || !payload.data) {
    throw new Error('更新推荐项响应格式无效');
  }
  return parseAdminRecommendationItem(payload.data as Record<string, unknown>);
}

export async function updateAdminPortalRecommendationStatus(
  id: number,
  status: 'enabled' | 'disabled',
): Promise<AdminPortalRecommendationItem> {
  const payload = await requestRemote<{ data?: unknown }>(`/system/search-hot-keywords/${id}/status`, {
    method: 'PATCH',
    body: { status },
  });
  if (!payload || typeof payload.data !== 'object' || !payload.data) {
    throw new Error('更新推荐项状态响应格式无效');
  }
  return parseAdminRecommendationItem(payload.data as Record<string, unknown>);
}

export async function deleteAdminPortalRecommendation(id: number): Promise<void> {
  await requestRemote<unknown>(`/system/search-hot-keywords/${id}`, {
    method: 'DELETE',
  });
}

export async function restoreAdminPortalRecommendationDefaults(
  scope: 'all' | 'hot_keyword' | 'ai_example' = 'all',
): Promise<AdminPortalRecommendationItem[]> {
  const payload = await requestRemote<{ items?: unknown }>('/system/search-hot-keywords/restore-defaults', {
    method: 'POST',
    body: { scope },
  });
  const rows = payload && Array.isArray(payload.items) ? payload.items : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .filter((row) => Number.isInteger(Number(row['id'])) && String(row['keyword'] || '').trim().length > 0)
    .map(parseAdminRecommendationItem);
}
