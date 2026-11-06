import { LONG_REQUEST_TIMEOUT } from "../config/request.ts";
import { requestRemoteEventStream, type RemoteServerSentEvent } from "./http.ts";
import { parseAiAskResponse, type AiAskResponse } from "./aiAsk.ts";

export type AiAskExecutionEventName = "step_start" | "step_complete" | "step_error" | "answer" | "done" | "keep_alive";
export type AiAskExecutionStatus = "running" | "completed" | "failed" | "cancelled";

export interface AiAskExecutionEvent {
  event: AiAskExecutionEventName;
  requestId: string;
  stepId: string;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface AiAskExecutionResult {
  response: AiAskResponse;
  status: AiAskExecutionStatus;
}

const EXECUTION_DATA_KEYS = new Set([
  "response", "status", "stepCount", "errorCode", "query", "originalQuery",
  "queryType", "keyConcepts", "queries", "planningMode", "fallbackReason",
  "round", "queryCount", "maxRequests", "requestCount", "resultCount",
  "supplementalQuery", "searchId", "startedAt", "finishedAt", "durationMs",
  "retrievalMode", "requestedMode", "effectiveMode", "channelsUsed", "verifiedCount",
  "hits", "retrievalRounds", "deduplicatedCount", "selectedAssetIds", "fusionMethod",
  "maxTables", "candidateCount", "verifiedTableCount", "verifiedFieldCount",
  "errorCount", "truncated", "source", "indexEvidenceOnly", "assetId", "nameHint",
  "tableName", "fieldCount", "fieldId", "fieldName", "evidenceCount", "assetIds",
  "selectedEvidenceCount", "citationIds", "intent", "tableCount", "elapsedMs",
]);
const HIT_DATA_KEYS = new Set([
  "rank", "assetId", "fieldId", "entityType", "name", "retrievalChannels", "matchedTerms",
]);

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAiAskExecutionEvent(event: RemoteServerSentEvent): AiAskExecutionEvent {
  if (!["step_start", "step_complete", "step_error", "answer", "done", "keep_alive"].includes(event.event)) {
    throw new Error("AI 问答进度流包含未知事件。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data) as unknown;
  } catch {
    throw new Error("AI 问答进度事件格式无效。");
  }
  if (!isRecord(parsed)) throw new Error("AI 问答进度事件格式无效。");
  const allowedKeys = new Set(["request_id", "step_id", "timestamp", "message", "data"]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    throw new Error("AI 问答进度事件包含不支持的数据。");
  }
  const requestId = parsed["request_id"];
  const stepId = parsed["step_id"];
  const timestamp = parsed["timestamp"];
  const message = parsed["message"];
  const rawData = parsed["data"];
  if (
    typeof requestId !== "string" || !/^[a-f0-9-]{8,64}$/i.test(requestId)
    || typeof stepId !== "string" || !/^[a-z0-9-]{1,80}$/i.test(stepId)
    || typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))
    || typeof message !== "string" || message.length > 300
    || (rawData !== undefined && !isRecord(rawData))
  ) {
    throw new Error("AI 问答进度事件格式无效。");
  }
  const data = isRecord(rawData) ? { ...rawData } : undefined;
  if (event.event === "keep_alive" && data !== undefined) {
    throw new Error("AI 问答 keep-alive 事件包含不支持的数据。");
  }
  if (data && Object.keys(data).some((key) => !EXECUTION_DATA_KEYS.has(key))) {
    throw new Error("AI 问答进度事件包含不支持的数据。");
  }
  if (event.event === "answer") {
    if (Object.keys(data || {}).some((key) => key !== "response")) {
      throw new Error("AI 问答答案事件包含不支持的数据。");
    }
    if (!data || !("response" in data)) throw new Error("AI 问答进度流缺少完整答案。");
    data["response"] = parseAiAskResponse(data["response"]);
  }
  if (event.event.startsWith("step_") && stepId === "metadata-count") {
    const count = data?.["tableCount"];
    if (
      data?.["intent"] !== "metadata_count"
      || (count !== undefined && (!Number.isSafeInteger(count) || Number(count) < 0))
    ) {
      throw new Error("AI 问答统计进度事件格式无效。");
    }
  }
  if (event.event.startsWith("step_") && data?.["hits"] !== undefined) {
    const hits = data["hits"];
    if (!Array.isArray(hits) || hits.length > 20 || hits.some((hit) =>
      !isRecord(hit) || Object.keys(hit).some((key) => !HIT_DATA_KEYS.has(key))
    )) {
      throw new Error("AI 问答检索命中事件格式无效。");
    }
  }
  if (event.event === "done") {
    const status = data?.["status"];
    if (Object.keys(data || {}).some((key) => key !== "status" && key !== "stepCount" && key !== "errorCode")) {
      throw new Error("AI 问答结束事件包含不支持的数据。");
    }
    if (status !== "completed" && status !== "failed" && status !== "cancelled") {
      throw new Error("AI 问答结束事件状态无效。");
    }
  }
  return {
    event: event.event as AiAskExecutionEventName,
    requestId,
    stepId,
    timestamp,
    message,
    ...(data ? { data } : {}),
  };
}

export async function askAiWithExecution(
  query: string,
  onEvent: (event: AiAskExecutionEvent) => void,
  scope = "all",
  topK = 10,
  signal?: AbortSignal,
): Promise<AiAskExecutionResult> {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery || normalizedQuery.length > 500) {
    throw new Error("问题长度必须为 1–500 个字符。");
  }
  if (typeof import.meta.env !== "undefined" && import.meta.env.VITE_API_MODE === "mock") {
    const { askMockAiWithExecution } = await import("../mock/aiAsk.ts");
    return askMockAiWithExecution(normalizedQuery, onEvent, scope, topK, signal);
  }
  if (API_MODE !== "remote") {
    throw new Error("当前运行模式未启用真实 AI 问答服务。");
  }

  let response: AiAskResponse | null = null;
  let requestId: string | null = null;
  let status: AiAskExecutionStatus | null = null;
  await requestRemoteEventStream("/ai/ask/stream", {
    method: "POST",
    body: { query: normalizedQuery, scope, topK },
    timeout: LONG_REQUEST_TIMEOUT,
    suppressUnauthorizedEvent: true,
    suppressTimeoutPayloadLogging: true,
    signal,
  }, (rawEvent) => {
    const event = parseAiAskExecutionEvent(rawEvent);
    if (requestId !== null && event.requestId !== requestId) {
      throw new Error("AI 问答进度流的请求标识不一致。");
    }
    requestId = event.requestId;
    if (status !== null) throw new Error("AI 问答结束后仍收到进度事件。");
    if (event.event === "keep_alive") return;
    if (event.event === "answer") {
      if (response !== null) throw new Error("AI 问答进度流返回了多个答案。");
      const parsed = event.data?.["response"];
      if (!parsed || typeof parsed !== "object") throw new Error("AI 问答进度流未返回完整答案。");
      response = parsed as AiAskResponse;
    } else if (event.event === "done") {
      if (status !== null) throw new Error("AI 问答进度流返回了多个结束事件。");
      status = event.data?.["status"] as AiAskExecutionStatus;
    }
    onEvent(event);
  });
  if (!response || status === null) throw new Error("AI 问答进度流未正常结束。");
  return { response, status };
}
