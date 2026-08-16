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

import { requestRemote } from "./http.js";
import { LONG_REQUEST_TIMEOUT } from "../config/request.js";

import { PUSH_SYSTEMS } from "../data/pushSystems.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const API_MODE = import.meta.env.VITE_API_MODE || "mock";
let mockSystems = clone(PUSH_SYSTEMS);

function readStore() {
  return clone(mockSystems);
}

function writeStore(systems) {
  mockSystems = clone(systems);
}

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.data && typeof payload.data === "object" ? payload.data : payload;
  }
  throw new Error("Invalid push payload");
}

function toPublicSystem(system) {
  return {
    systemId: system.systemId,
    id: system.id,
    name: system.name,
    abbr: system.abbr,
    desc: system.desc || "",
    protocol: system.protocol,
    host: system.host || "",
    downstreamContact: system.downstreamContact || system.contact || "",
    dataDeveloperContact: system.dataDeveloperContact || "",
    dept: system.dept || "",
    status: system.status,
    importanceLevel: system.importanceLevel || "normal",
    latestOutputTime: system.latestOutputTime || "",
    jobs: (system.jobs || []).map((job) => ({
      id: job.id,
      cn: job.cn,
      sourceFileName: job.sourceFileName || job.targetFileName || "",
      targetFileName: job.targetFileName || job.sourceFileName || "",
      freq: job.freq || "",
      freqType: job.freqType || "",
      enabled: Boolean(job.enabled),
      desc: job.desc || "",
    })),
  };
}

export async function getPushSystems(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/push/systems", {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeCollection(payload, "systems");
  }
  return readStore().map((system, index) => toPublicSystem({ ...system, systemId: system.systemId || index + 1 }));
}

export async function getPushSystemAdminDetail(systemId) {
  if (API_MODE === "remote") {
    return normalizeDetail(await requestRemote(`/push/systems/${encodeURIComponent(systemId)}/admin-detail`));
  }
  const system = readStore().find((item) => item.id === systemId);
  if (!system) throw new Error(`System not found: ${systemId}`);
  return clone(system);
}

export async function savePushSystem(system, oldId) {
  if (API_MODE === "remote") {
    const payload = oldId
      ? await requestRemote(`/push/systems/${encodeURIComponent(oldId)}`, { method: "PUT", body: system })
      : await requestRemote("/push/systems", { method: "POST", body: system });
    return normalizeDetail(payload);
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

export async function deletePushSystem(systemId) {
  if (API_MODE === "remote") {
    await requestRemote(`/push/systems/${encodeURIComponent(systemId)}`, { method: "DELETE" });
    return;
  }
  writeStore(readStore().filter((item) => item.id !== systemId));
}

export async function savePushJob(systemId, job, oldId) {
  if (API_MODE === "remote") {
    const payload = oldId
      ? await requestRemote(
        `/push/systems/${encodeURIComponent(systemId)}/jobs/${encodeURIComponent(oldId)}`,
        { method: "PUT", body: job },
      )
      : await requestRemote(`/push/systems/${encodeURIComponent(systemId)}/jobs`, { method: "POST", body: job });
    return normalizeDetail(payload);
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

export async function deletePushJob(systemId, jobId) {
  if (API_MODE === "remote") {
    await requestRemote(
      `/push/systems/${encodeURIComponent(systemId)}/jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
    );
    return;
  }

  const systems = readStore().map((system) => {
    if (system.id !== systemId) return system;
    return { ...system, jobs: system.jobs.filter((job) => job.id !== jobId) };
  });

  writeStore(systems);
}

export async function resetPushOverrides() {
  mockSystems = clone(PUSH_SYSTEMS);
}
