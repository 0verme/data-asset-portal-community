/// <reference types="vite/client" />

import { requestRemote } from "./http.ts";

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

export interface AiLlmDailyQuota {
  parameterCode: "AI_LLM_DAILY_LIMIT";
  dailyLimit: number;
  used: number;
  remaining: number;
  businessDate: string;
  timezone: "Asia/Shanghai";
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  disableThinking: boolean;
  apiKeyConfigured: boolean;
}

export interface AiLlmDailyQuotaUpdate {
  dailyLimit?: number;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  disableThinking?: boolean;
}

export const DEFAULT_AI_LLM_DAILY_QUOTA: AiLlmDailyQuota = {
  parameterCode: "AI_LLM_DAILY_LIMIT",
  dailyLimit: 50,
  used: 0,
  remaining: 50,
  businessDate: "",
  timezone: "Asia/Shanghai",
  enabled: false,
  baseUrl: "",
  model: "",
  timeoutMs: 30000,
  maxTokens: 3072,
  disableThinking: false,
  apiKeyConfigured: false,
};

export function supportsAiLlmDailyQuota(): boolean {
  return API_MODE === "remote";
}

function unwrap(payload: unknown): AiLlmDailyQuota {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("每日 AI 问答额度接口返回格式无效。");
  }
  const data = (payload as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("每日 AI 问答额度接口缺少 data。");
  }
  const value = data as Record<string, unknown>;
  if (
    value["parameterCode"] !== "AI_LLM_DAILY_LIMIT"
    || typeof value["dailyLimit"] !== "number"
    || typeof value["used"] !== "number"
    || typeof value["remaining"] !== "number"
    || typeof value["businessDate"] !== "string"
    || value["timezone"] !== "Asia/Shanghai"
  ) {
    throw new Error("每日 AI 问答额度接口字段无效。");
  }
  const enabled = value["enabled"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.enabled : value["enabled"];
  const baseUrl = value["baseUrl"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.baseUrl : value["baseUrl"];
  const model = value["model"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.model : value["model"];
  const timeoutMs = value["timeoutMs"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.timeoutMs : value["timeoutMs"];
  const maxTokens = value["maxTokens"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.maxTokens : value["maxTokens"];
  const disableThinking = value["disableThinking"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.disableThinking : value["disableThinking"];
  const apiKeyConfigured = value["apiKeyConfigured"] === undefined ? DEFAULT_AI_LLM_DAILY_QUOTA.apiKeyConfigured : value["apiKeyConfigured"];
  if (
    typeof enabled !== "boolean"
    || typeof baseUrl !== "string"
    || typeof model !== "string"
    || typeof timeoutMs !== "number"
    || typeof maxTokens !== "number"
    || typeof disableThinking !== "boolean"
    || typeof apiKeyConfigured !== "boolean"
  ) {
    throw new Error("AI 问答配置接口字段无效。");
  }
  return {
    parameterCode: "AI_LLM_DAILY_LIMIT",
    dailyLimit: value["dailyLimit"],
    used: value["used"],
    remaining: value["remaining"],
    businessDate: value["businessDate"],
    timezone: "Asia/Shanghai",
    enabled,
    baseUrl,
    model,
    timeoutMs,
    maxTokens,
    disableThinking,
    apiKeyConfigured,
  };
}

export async function getAiLlmDailyQuota(): Promise<AiLlmDailyQuota> {
  if (!supportsAiLlmDailyQuota()) return { ...DEFAULT_AI_LLM_DAILY_QUOTA };
  return unwrap(await requestRemote("/system/ai-llm-daily-quota"));
}

export async function updateAiLlmDailyQuota(
  input: number | AiLlmDailyQuotaUpdate,
): Promise<AiLlmDailyQuota> {
  if (!supportsAiLlmDailyQuota()) {
    throw new Error("模拟模式不支持持久化每日 AI 问答额度。");
  }
  const body: AiLlmDailyQuotaUpdate = typeof input === "number" ? { dailyLimit: input } : input;
  return unwrap(await requestRemote("/system/ai-llm-daily-quota", {
    method: "PUT",
    body,
  }));
}
