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
import { UPSTREAM_SYSTEMS, type MockUpstreamSystem } from '../data/upstreamSystems.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let mockUpstreamSystems: MockUpstreamSystem[] = clone(UPSTREAM_SYSTEMS as MockUpstreamSystem[]);

function readStore(): MockUpstreamSystem[] {
  return clone(mockUpstreamSystems);
}

function writeStore(items: MockUpstreamSystem[]): void {
  mockUpstreamSystems = clone(items);
}

function normalizeCollection<T>(payload: unknown, fallbackKey?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as T[];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as T[];
  return [];
}

function normalizeDetail<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as T;
  }
  throw new Error('Invalid upstream payload');
}

export type PublicUpstreamSystem = Omit<MockUpstreamSystem, 'host' | 'db' | 'schema'>;

function toPublicSystem(system: MockUpstreamSystem): PublicUpstreamSystem {
  const { host: _host, db: _db, schema: _schema, ...summary } = system;
  return summary;
}

export interface UpstreamQueryParams {
  keyword?: string | undefined;
  status?: string | undefined;
  dbType?: string | undefined;
  [key: string]: unknown;
}

export async function getUpstreamSystems(params: UpstreamQueryParams = {}): Promise<PublicUpstreamSystem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/upstreams/systems', {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeCollection<PublicUpstreamSystem>(payload, 'systems');
  }
  const q = params.keyword?.trim().toLowerCase();
  return readStore()
    .filter((item) => {
      if (params.status && item.status !== params.status) return false;
      if (params.dbType && item.dbType !== params.dbType) return false;
      if (!q) return true;
      return [item.id, item.abbr, item.name, item.owner, item.dept, item.desc].some((value) =>
        String(value || '').toLowerCase().includes(q),
      );
    })
    .map(toPublicSystem);
}

export async function getUpstreamSystem(systemId: string): Promise<PublicUpstreamSystem> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}`);
    return normalizeDetail<PublicUpstreamSystem>(payload);
  }
  const item = readStore().find((system) => system.id === systemId);
  if (!item) throw new Error(`System not found: ${systemId}`);
  return toPublicSystem(item);
}

export async function getUpstreamSystemAdminDetail(systemId: string): Promise<MockUpstreamSystem> {
  if (API_MODE === 'remote') {
    return normalizeDetail<MockUpstreamSystem>(
      await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}/admin-detail`),
    );
  }
  const item = readStore().find((system) => system.id === systemId);
  if (!item) throw new Error(`System not found: ${systemId}`);
  return clone(item);
}

export async function saveUpstreamSystem(system: MockUpstreamSystem, oldId?: string): Promise<MockUpstreamSystem> {
  if (API_MODE === 'remote') {
    const payload = oldId
      ? await requestRemote(`/upstreams/systems/${encodeURIComponent(oldId)}`, { method: 'PUT', body: system })
      : await requestRemote('/upstreams/systems', { method: 'POST', body: system });
    return normalizeDetail<MockUpstreamSystem>(payload);
  }

  const items = readStore();
  const next = items.filter((item) => item.id !== oldId && item.id !== system.id);
  next.unshift(clone(system));
  writeStore(next);
  return clone(system);
}

export async function patchUpstreamStatus(
  systemId: string,
  status: string,
): Promise<MockUpstreamSystem | undefined> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}/status`, {
      method: 'PATCH',
      body: { status },
    });
    return normalizeDetail<MockUpstreamSystem>(payload);
  }
  const items = readStore().map((item) => (item.id === systemId ? { ...item, status } : item));
  writeStore(items);
  return clone(items.find((item) => item.id === systemId));
}

export async function deleteUpstreamSystem(systemId: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}`, { method: 'DELETE' });
    return;
  }
  writeStore(readStore().filter((item) => item.id !== systemId));
}

export async function resetUpstreamOverrides(): Promise<void> {
  mockUpstreamSystems = clone(UPSTREAM_SYSTEMS as MockUpstreamSystem[]);
}
