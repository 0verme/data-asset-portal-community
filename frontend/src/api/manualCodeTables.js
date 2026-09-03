import { requestRemote } from "./http.js";
import { MANUAL_CODE_TABLES } from "../data/manualCodeTables.ts";

const API_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase();
let mockItems = structuredClone(MANUAL_CODE_TABLES);

const clone = (value) => structuredClone(value);
const nowText = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const detail = (payload) => payload?.data || payload;
const MANUAL_CODE_TABLE_STATUS_VALUES = new Set(["enabled", "disabled"]);

function normalizeManualCodeTablePayload(payload) {
  const normalized = { ...clone(payload), status: String(payload?.status || "enabled").trim().toLowerCase() };
  if (!MANUAL_CODE_TABLE_STATUS_VALUES.has(normalized.status)) {
    throw new Error("码值表状态仅支持启用或禁用");
  }
  return normalized;
}

function normalizeManualCodeTableStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!MANUAL_CODE_TABLE_STATUS_VALUES.has(normalized)) {
    throw new Error("码值表状态仅支持启用或禁用");
  }
  return normalized;
}

export async function getManualCodeTables(filters = {}) {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/manual-code-tables", { params: filters });
    return Array.isArray(payload?.items) ? payload.items : [];
  }
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  return clone(mockItems.filter((item) => {
    if (filters.style && item.style !== filters.style) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (!keyword) return true;
    return [item.tableCode, item.tableName, item.owner, item.remark]
      .some((value) => String(value || "").toLowerCase().includes(keyword));
  }));
}

export async function createManualCodeTable(payload) {
  const normalizedPayload = normalizeManualCodeTablePayload(payload);
  if (API_MODE === "remote") {
    return detail(await requestRemote("/manual-code-tables", { method: "POST", body: normalizedPayload }));
  }
  if (mockItems.some((item) => item.tableCode === normalizedPayload.tableCode)) throw new Error(`码表编码已存在：${normalizedPayload.tableCode}`);
  const id = String(Math.max(0, ...mockItems.map((item) => Number(item.id) || 0)) + 1);
  const item = { id, ...normalizedPayload, updatedAt: nowText() };
  mockItems.unshift(item);
  return clone(item);
}

export async function updateManualCodeTable(id, payload) {
  const normalizedPayload = normalizeManualCodeTablePayload(payload);
  if (API_MODE === "remote") {
    return detail(await requestRemote(`/manual-code-tables/${encodeURIComponent(id)}`, { method: "PUT", body: normalizedPayload }));
  }
  if (mockItems.some((item) => item.id !== id && item.tableCode === normalizedPayload.tableCode)) throw new Error(`码表编码已存在：${normalizedPayload.tableCode}`);
  const current = mockItems.find((item) => item.id === id);
  if (!current) throw new Error(`码表不存在：${id}`);
  const item = { ...current, ...normalizedPayload, updatedAt: nowText() };
  mockItems = mockItems.map((row) => row.id === id ? item : row);
  return clone(item);
}

export async function updateManualCodeTableStatus(id, status) {
  const normalizedStatus = normalizeManualCodeTableStatus(status);
  if (API_MODE === "remote") {
    return detail(await requestRemote(`/manual-code-tables/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status: normalizedStatus } }));
  }
  const current = mockItems.find((item) => item.id === id);
  if (!current) throw new Error(`码表不存在：${id}`);
  const item = { ...current, status: normalizedStatus, updatedAt: nowText() };
  mockItems = mockItems.map((row) => row.id === id ? item : row);
  return clone(item);
}

export async function deleteManualCodeTable(id) {
  if (API_MODE === "remote") {
    await requestRemote(`/manual-code-tables/${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }
  mockItems = mockItems.filter((item) => item.id !== id);
}
