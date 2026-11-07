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
}

export const DEFAULT_AI_LLM_DAILY_QUOTA: AiLlmDailyQuota = {
  parameterCode: "AI_LLM_DAILY_LIMIT",
  dailyLimit: 50,
  used: 0,
  remaining: 50,
  businessDate: "",
  timezone: "Asia/Shanghai",
};

export function supportsAiLlmDailyQuota(): boolean {
  return API_MODE === "remote";
}

function unwrap(payload: unknown): AiLlmDailyQuota {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("每日 LLM 额度接口返回格式无效。");
  }
  const data = (payload as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("每日 LLM 额度接口缺少 data。");
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
    throw new Error("每日 LLM 额度接口字段无效。");
  }
  return value as unknown as AiLlmDailyQuota;
}

export async function getAiLlmDailyQuota(): Promise<AiLlmDailyQuota> {
  if (!supportsAiLlmDailyQuota()) return { ...DEFAULT_AI_LLM_DAILY_QUOTA };
  return unwrap(await requestRemote("/system/ai-llm-daily-quota"));
}

export async function updateAiLlmDailyQuota(dailyLimit: number): Promise<AiLlmDailyQuota> {
  if (!supportsAiLlmDailyQuota()) {
    throw new Error("模拟模式不支持持久化每日 LLM 额度。");
  }
  return unwrap(await requestRemote("/system/ai-llm-daily-quota", {
    method: "PUT",
    body: { dailyLimit },
  }));
}
