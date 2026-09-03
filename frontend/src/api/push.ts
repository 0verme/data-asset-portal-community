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
import { PUSH_SYSTEMS, type PushSystemItem, type PushJobItem } from '../data/pushSystems.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  throw new Error('Invalid push payload');
}

export interface PublicPushJob {
  id: string;
  cn: string;
  sourcePath: string;
  sourceFileName: string;
  targetPath: string;
  targetFileName: string;
  freq: string;
  freqType: string;
  enabled: boolean;
  desc: string;
}

export interface PublicPushSystem {
  systemId?: number | undefined;
  id: string;
  name: string;
  abbr: string;
  desc: string;
  protocol: string;
  dept: string;
  status: string;
  importanceLevel: string;
  latestOutputTime: string;
  jobs: PublicPushJob[];
  [key: string]: unknown;
}

function toPublicSystem(system: PushSystemItem & { systemId?: number | undefined }): PublicPushSystem {
  return {
    systemId: system.systemId,
    id: system.id,
    name: system.name,
    abbr: system.abbr,
    desc: system.desc || '',
    protocol: system.protocol,
    dept: system.dept || '',
    status: system.status,
    importanceLevel: system.importanceLevel || 'normal',
    latestOutputTime: system.latestOutputTime || '',
    jobs: (system.jobs || []).map((job) => ({
      id: job.id,
      cn: job.cn,
      sourcePath: job.sourcePath || '',
      sourceFileName: job.sourceFileName || job.targetFileName || '',
      targetPath: job.targetPath || '',
      targetFileName: job.targetFileName || job.sourceFileName || '',
      freq: job.freq || '',
      freqType: job.freqType || '',
      enabled: Boolean(job.enabled),
      desc: job.desc || '',
    })),
  };
}

export interface PushQueryParams {
  importanceLevel?: string | undefined;
  keyword?: string | undefined;
  [key: string]: unknown;
}

export async function getPushSystems(params: PushQueryParams = {}): Promise<PublicPushSystem[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/push/systems', {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeCollection<PublicPushSystem>(payload, 'systems');
  }
  return readStore().map((system, index) => toPublicSystem({ ...system, systemId: index + 1 }));
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
