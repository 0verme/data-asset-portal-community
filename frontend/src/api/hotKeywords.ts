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
import type { PortalHotKeyword } from '../config/portalSearch.ts';

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
