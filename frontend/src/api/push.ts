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
import { parseCollectionResponse } from './collectionResponse.ts';
import { LONG_REQUEST_TIMEOUT } from '../config/request.ts';
import { PUSH_SYSTEMS, type PushSystemItem, type PushJobItem, type PushJobField } from '../data/pushSystems.ts';

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

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

let mockSystems: PushSystemItem[] = clone(PUSH_SYSTEMS as PushSystemItem[]);

function readStore(): PushSystemItem[] {
  return clone(mockSystems);
}

function writeStore(systems: PushSystemItem[]): void {
  mockSystems = clone(systems);
}

export function normalizeCollection<T>(payload: unknown): T[] {
  return parseCollectionResponse<T>(payload, '推送系统列表');
}

function normalizeDetail<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as T;
  }
  throw new Error('Invalid push payload');
}

export interface PublicPushJob {
  id: string;
  cn: string;
  sourceFileName: string;
  targetFileName: string;
  freq: string;
  freqType: string;
  enabled: boolean;
  desc: string;
  fields: PushJobField[];
}

export interface PublicPushSystem {
  systemId?: number | undefined;
  id: string;
  name: string;
  abbr: string;
  desc: string;
  protocol: string;
  downstreamContact?: string | undefined;
  dataDeveloperContact?: string | undefined;
  dept: string;
  status: string;
  importanceLevel: string;
  latestOutputTime: string;
  jobCount?: number | undefined;
  jobs: PublicPushJob[];
}

function toPublicSystem(system: PushSystemItem & { systemId?: number | undefined }): PublicPushSystem {
  return {
    systemId: system.systemId,
    id: system.id,
    name: system.name,
    abbr: system.abbr,
    desc: system.desc || '',
    protocol: system.protocol,
    downstreamContact: system.downstreamContact || '',
    dataDeveloperContact: system.dataDeveloperContact || '',
    dept: system.dept || '',
    status: system.status,
    importanceLevel: system.importanceLevel || 'normal',
    latestOutputTime: system.latestOutputTime || '',
    jobs: (system.jobs || []).map((job) => ({
      id: job.id,
      cn: job.cn,
      sourceFileName: job.sourceFileName || job.targetFileName || '',
      targetFileName: job.targetFileName || job.sourceFileName || '',
      freq: job.freq || '',
      freqType: job.freqType || '',
      enabled: Boolean(job.enabled),
      desc: job.desc || '',
      fields: clone(job.fields || []),
    })),
  };
}

export interface PushQueryParams {
  importanceLevel?: string | undefined;
  keyword?: string | undefined;
  status?: string | undefined;
  protocol?: string | undefined;
  dept?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  sortKey?: string | undefined;
  sortDirection?: string | undefined;
  [key: string]: unknown;
}

export async function getPushSystems(params: PushQueryParams = {}): Promise<PublicPushSystem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/push/systems', {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeCollection<PublicPushSystem>(payload);
  }
  return readStore().map((system, index) => toPublicSystem({ ...system, systemId: index + 1 }));
}

export interface PushSystemPage {
  items: PublicPushSystem[];
  total: number;
  page: number;
  pageSize: number;
  facets: { status: Record<string, number>; protocol: Record<string, number>; dept: Record<string, number>; importanceLevel: Record<string, number> };
  options: { systemIds: string[]; protocols: string[]; depts: string[]; freqTypes: string[] };
  stats: { systemCount: number; jobCount: number };
}

export async function getPushSystemPage(params: PushQueryParams = {}): Promise<PushSystemPage> {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.max(1, params.pageSize || 20);
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/push/systems', {
      params: { ...params, page, pageSize }, timeout: LONG_REQUEST_TIMEOUT,
    }) as PushSystemPage;
    if (!payload || !Array.isArray(payload.items) || !Number.isFinite(payload.total) || !payload.facets || !payload.options || !payload.stats) {
      throw new Error('Invalid push page payload');
    }
    return payload;
  }
  const all = readStore().map((system, index) => toPublicSystem({ ...system, systemId: index + 1 }));
  const keyword = params.keyword?.trim().toLowerCase();
  const matches = all.filter((item) => {
    if (params.status && item.status !== params.status) return false;
    if (params.protocol && item.protocol !== params.protocol) return false;
    if (params.dept && item.dept !== params.dept) return false;
    if (params.importanceLevel && item.importanceLevel !== params.importanceLevel) return false;
    return !keyword || [item.id, item.name, item.abbr, item.dept, item.desc,
      ...item.jobs.flatMap((job) => [job.id, job.cn, job.sourceFileName, job.targetFileName, job.desc]),
    ].some((value) => value.toLowerCase().includes(keyword));
  });
  const columns: Record<string, keyof PublicPushSystem> = { id: 'id', name: 'name', protocol: 'protocol', dept: 'dept' };
  const key = columns[params.sortKey || ''];
  const direction = params.sortDirection === 'desc' ? -1 : 1;
  matches.sort((left, right) => {
    const primary = key ? String(left[key]).localeCompare(String(right[key]))
      : Number(left.importanceLevel !== 'important') - Number(right.importanceLevel !== 'important');
    return primary * direction || left.id.localeCompare(right.id);
  });
  const facets: PushSystemPage['facets'] = { status: {}, protocol: {}, dept: {}, importanceLevel: {} };
  for (const item of all) {
    for (const field of ['status', 'protocol', 'dept', 'importanceLevel'] as const) {
      const value = item[field];
      if (value) facets[field][value] = (facets[field][value] || 0) + 1;
    }
  }
  return {
    items: matches.slice((page - 1) * pageSize, page * pageSize).map((item) => ({ ...item, jobCount: item.jobs.length, jobs: [] })),
    total: matches.length, page, pageSize, facets,
    options: {
      systemIds: all.map((item) => item.id).sort(), protocols: Object.keys(facets.protocol).sort(), depts: Object.keys(facets.dept).sort(),
      freqTypes: [...new Set(all.flatMap((item) => item.jobs.map((job) => job.freqType)).filter(Boolean))].sort(),
    },
    stats: { systemCount: all.length, jobCount: all.reduce((sum, item) => sum + item.jobs.length, 0) },
  };
}

export async function getPushSystem(systemId: string): Promise<PublicPushSystem> {
  if (API_MODE === 'remote') {
    return normalizeDetail<PublicPushSystem>(await requestRemote(`/push/systems/${encodeURIComponent(systemId)}`));
  }
  const systems = readStore();
  const index = systems.findIndex((system) => system.id === systemId);
  const item = systems[index];
  if (!item) throw new Error(`System not found: ${systemId}`);
  return toPublicSystem({ ...item, systemId: index + 1 });
}

export async function getPushSystemAdminDetail(systemId: string): Promise<PushSystemItem> {
  if (API_MODE === 'remote') {
    return normalizeDetail<PushSystemItem>(
      await requestRemote(`/push/systems/${encodeURIComponent(systemId)}/admin-detail`),
    );
  }
  const system = readStore().find((item) => item.id === systemId);
  if (!system) throw new Error(`System not found: ${systemId}`);
  return clone(system);
}

export async function savePushSystem(system: PushSystemItem, oldId?: string): Promise<PushSystemItem> {
  if (API_MODE === 'remote') {
    const payload = oldId
      ? await requestRemote(`/push/systems/${encodeURIComponent(oldId)}`, { method: 'PUT', body: system })
      : await requestRemote('/push/systems', { method: 'POST', body: system });
    return normalizeDetail<PushSystemItem>(payload);
  }

  const systems = readStore();
  const next = systems.slice();
  const index = oldId ? next.findIndex((item) => item.id === oldId) : -1;

  if (index >= 0) {
    next[index] = clone(system);
  } else {
    next.unshift(clone(system));
  }

  writeStore(next);
  return clone(system);
}

export async function deletePushSystem(systemId: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/push/systems/${encodeURIComponent(systemId)}`, { method: 'DELETE' });
    return;
  }
  writeStore(readStore().filter((item) => item.id !== systemId));
}

export async function savePushJob(systemId: string, job: PushJobItem, oldId?: string): Promise<PushJobItem> {
  if (API_MODE === 'remote') {
    const payload = oldId
      ? await requestRemote(
          `/push/systems/${encodeURIComponent(systemId)}/jobs/${encodeURIComponent(oldId)}`,
          { method: 'PUT', body: job },
        )
      : await requestRemote(`/push/systems/${encodeURIComponent(systemId)}/jobs`, {
          method: 'POST',
          body: job,
        });
    return normalizeDetail<PushJobItem>(payload);
  }

  const systems = readStore().map((system) => {
    if (system.id !== systemId) return system;

    const jobs = system.jobs.slice();
    const index = oldId ? jobs.findIndex((item) => item.id === oldId) : -1;

    if (index >= 0) {
      jobs[index] = clone(job);
    } else {
      jobs.unshift(clone(job));
    }

    return { ...system, jobs };
  });

  writeStore(systems);
  return clone(job);
}

export async function deletePushJob(systemId: string, jobId: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(
      `/push/systems/${encodeURIComponent(systemId)}/jobs/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' },
    );
    return;
  }

  const systems = readStore().map((system) => {
    if (system.id !== systemId) return system;
    return { ...system, jobs: system.jobs.filter((job) => job.id !== jobId) };
  });

  writeStore(systems);
}

export async function resetPushOverrides(): Promise<void> {
  mockSystems = clone(PUSH_SYSTEMS as PushSystemItem[]);
}
