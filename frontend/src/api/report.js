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
import { REPORTS } from "../data/reports.js";

const API_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase();
let mockReports = clone(REPORTS);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const detail = payload.data && typeof payload.data === "object" ? payload.data : payload;
    return clone(detail);
  }
  throw new Error("Invalid report payload");
}

function readStore() {
  return clone(mockReports);
}

function writeStore(items) {
  mockReports = clone(items);
}

function filterReports(items, params = {}) {
  const keyword = String(params.keyword || "").trim().toLowerCase();
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
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
  });
}

export async function getReportList(params = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/reports", { params });
    return normalizeCollection(payload, "items");
  }
  return filterReports(readStore(), params);
}

export async function getReportDetail(reportCode) {
  if (API_MODE === "remote") {
    const payload = await requestRemote(`/reports/${encodeURIComponent(reportCode)}`);
    return normalizeDetail(payload);
  }
  const item = readStore().find((report) => report.code === reportCode);
  if (!item) throw new Error(`Report not found: ${reportCode}`);
  return clone(item);
}

export async function createReport(payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote("/reports", { method: "POST", body: payload });
    return normalizeDetail(response);
  }
  const items = readStore();
  if (items.some((item) => item.code === payload.code)) {
    throw new Error(`Report already exists: ${payload.code}`);
  }
  const nextItem = {
    ...clone(payload),
    updatedBy: "system",
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  writeStore([nextItem, ...items]);
  return clone(nextItem);
}

export async function updateReport(reportCode, payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/reports/${encodeURIComponent(reportCode)}`, {
      method: "PUT",
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
  const nextItem = {
    ...clone(payload),
    updatedBy: "system",
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  writeStore([nextItem, ...items.filter((item) => item.code !== reportCode && item.code !== payload.code)]);
  return clone(nextItem);
}

export async function deleteReport(reportCode) {
  if (API_MODE === "remote") {
    await requestRemote(`/reports/${encodeURIComponent(reportCode)}`, { method: "DELETE" });
    return;
  }
  writeStore(readStore().filter((item) => item.code !== reportCode));
}
