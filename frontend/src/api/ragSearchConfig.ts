/// <reference types="vite/client" />

import { requestRemote } from "./http.ts";

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

export interface RagSearchConfig {
  enabled: boolean;
  serviceUrl: string;
  strategy: "auto" | "keyword" | "vector" | "hybrid";
  topK: number;
  timeoutMs: number;
  /** Presence only; the token itself remains in backend deployment Secret storage. */
  tokenConfigured: boolean;
}

export interface RagSearchDiagnostics {
  status: "disabled" | "ready" | "unavailable";
  reasonCode?: string | null;
  health?: "ok" | "unknown" | "unavailable";
  ready?: boolean;
  tokenConfigured?: boolean;
}

export const DEFAULT_RAG_SEARCH_CONFIG: RagSearchConfig = {
  enabled: false,
  serviceUrl: "",
  strategy: "auto",
  topK: 5,
  timeoutMs: 2000,
  tokenConfigured: false,
};

export function supportsRagSearchConfig(): boolean {
  return API_MODE === "remote";
}

function unwrap<T>(payload: unknown): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("RAG 配置接口返回格式无效。");
  }
  const data = (payload as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("RAG 配置接口缺少 data。");
  }
  return data as T;
}

export async function getRagSearchConfig(): Promise<RagSearchConfig> {
  if (!supportsRagSearchConfig()) return { ...DEFAULT_RAG_SEARCH_CONFIG };
  return unwrap<RagSearchConfig>(await requestRemote("/system/rag-search-config"));
}

export async function updateRagSearchConfig(
  config: RagSearchConfig,
): Promise<RagSearchConfig> {
  if (!supportsRagSearchConfig()) {
    throw new Error("模拟模式不支持持久化 RAG 配置。");
  }
  return unwrap<RagSearchConfig>(
    await requestRemote("/system/rag-search-config", {
      method: "PUT",
      body: {
        enabled: config.enabled,
        serviceUrl: config.serviceUrl,
        strategy: config.strategy,
        topK: config.topK,
        timeoutMs: config.timeoutMs,
      },
    }),
  );
}

export async function getRagSearchDiagnostics(): Promise<RagSearchDiagnostics> {
  if (!supportsRagSearchConfig()) {
    return {
      status: "disabled",
      reasonCode: "disabled",
      health: "unknown",
      ready: false,
      tokenConfigured: false,
    };
  }
  return unwrap<RagSearchDiagnostics>(
    await requestRemote("/system/rag-search-config/diagnostics"),
  );
}
