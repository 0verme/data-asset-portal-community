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

import { UPSTREAM_SYSTEMS } from "../data/upstreamSystems.js";

const API_MODE = import.meta.env.VITE_API_MODE || "mock";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let mockUpstreamSystems = clone(UPSTREAM_SYSTEMS);

function readStore() {
  return clone(mockUpstreamSystems);
}

function writeStore(items) {
  mockUpstreamSystems = clone(items);
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
  throw new Error("Invalid upstream payload");
}

function toPublicSystem(system) {
  const { host, db, schema, ...summary } = system;
  return summary;
}

export async function getUpstreamSystems(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/upstreams/systems", {
      params,
      timeout: LONG_REQUEST_TIMEOUT,
    });
    return normalizeCollection(payload, "systems");
  }
  const q = params.keyword?.trim().toLowerCase();
  return readStore().filter((item) => {
    if (params.status && item.status !== params.status) return false;
    if (params.dbType && item.dbType !== params.dbType) return false;
    if (!q) return true;
    return [item.id, item.abbr, item.name, item.owner, item.dept, item.desc].some((value) =>
      String(value || "").toLowerCase().includes(q),
    );
  }).map(toPublicSystem);
}

export async function getUpstreamSystem(systemId) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}`);
    return normalizeDetail(payload);
  }
  const item = readStore().find((system) => system.id === systemId);
  if (!item) throw new Error(`System not found: ${systemId}`);
  return toPublicSystem(item);
}

export async function getUpstreamSystemAdminDetail(systemId) {
  if (API_MODE === "remote") {
    return normalizeDetail(await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}/admin-detail`));
  }
  const item = readStore().find((system) => system.id === systemId);
  if (!item) throw new Error(`System not found: ${systemId}`);
  return clone(item);
}

export async function saveUpstreamSystem(system, oldId) {
  if (API_MODE === "remote") {
    const payload = oldId
      ? await requestRemote(`/upstreams/systems/${encodeURIComponent(oldId)}`, { method: "PUT", body: system })
      : await requestRemote("/upstreams/systems", { method: "POST", body: system });
    return normalizeDetail(payload);
  }

  const items = readStore();
  const next = items.filter((item) => item.id !== oldId && item.id !== system.id);
  next.unshift(clone(system));
  writeStore(next);
  return clone(system);
}

export async function patchUpstreamStatus(systemId, status) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}/status`, {
      method: "PATCH",
      body: { status },
    });
    return normalizeDetail(payload);
  }
  const items = readStore().map((item) => (
    item.id === systemId ? { ...item, status } : item
  ));
  writeStore(items);
  return clone(items.find((item) => item.id === systemId));
}

export async function deleteUpstreamSystem(systemId) {
  if (API_MODE === "remote") {
    await requestRemote(`/upstreams/systems/${encodeURIComponent(systemId)}`, { method: "DELETE" });
    return;
  }
  writeStore(readStore().filter((item) => item.id !== systemId));
}

export async function resetUpstreamOverrides() {
  mockUpstreamSystems = clone(UPSTREAM_SYSTEMS);
}
