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
  "selectedEvidenceCount", "citationIds", "intent", "tableCount", "reportCount", "elapsedMs",
  // 阶段与目录核验统计。来源为后端实际发出的字段：
  // backend/app/services/rag_search_service.py（catalog_*、search complete）与
  // backend/app/services/ai_ask_execution_service.py（verification、asset-*、metadata-count）。
  "phase", "candidateAssetCount", "candidateFieldCount", "databaseCallCount",
  "verifiedAssetCount", "stageTimings",
  // `done` 事件会带上 AiAskResponse.reasonCode（如 insufficient_evidence、partial_results）。
  "reasonCode",
]);
const HIT_DATA_KEYS = new Set([
  "rank", "assetId", "fieldId", "entityType", "name", "retrievalChannels", "matchedTerms",
]);

/**
 * 阶段标签的唯一合法取值。后端目前只在读取 DAP 目录/数据库的阶段标记
 * `database`（catalog-*、asset-*、verification、metadata-count）。
 * 后端新增阶段时必须同步更新这里；backend/tests/fixtures/ai_ask_stream_contract.json
 * 与 frontend/src/api/aiAskExecutionContract.test.ts 会在 CI 中强制这次配套修改。
 */
const EXECUTION_PHASES = new Set(["database"]);

/** `stageTimings` 只允许后端真实统计的阶段耗时键。 */
const STAGE_TIMING_KEYS = new Set(["httpSearchMs", "catalogValidationMs"]);

/**
 * 计数类字段：后端一律由 len()/int() 产生，因此必须是非负安全整数。
 * 允许 `undefined`（字段未上报），但一旦出现就必须是整数，不能是字符串、浮点或负数。
 */
const EXECUTION_COUNT_KEYS = [
  "stepCount", "round", "queryCount", "maxRequests", "requestCount", "resultCount",
  "verifiedCount", "retrievalRounds", "deduplicatedCount", "maxTables", "candidateCount",
  "verifiedTableCount", "verifiedFieldCount", "errorCount", "fieldCount", "evidenceCount",
  "selectedEvidenceCount", "tableCount", "reportCount", "candidateAssetCount", "candidateFieldCount",
  "databaseCallCount", "verifiedAssetCount",
];

/** 耗时字段：后端由秒差 × 1000 产生，允许小数但必须是有限非负数。 */
const EXECUTION_DURATION_KEYS = ["durationMs", "elapsedMs"];

const DONE_DATA_KEYS = new Set(["status", "stepCount", "reasonCode"]);
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * 前端侧 SSE 事件契约违规（未知事件、未知字段、字段类型/取值越界）。
 * 与后端检索失败、网络故障严格区分：抛出本错误时后端可能已经正常完成检索。
 */
export class AiAskExecutionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAskExecutionContractError";
  }
}

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(message: string): never {
  throw new AiAskExecutionContractError(message);
}

function isNonNegativeCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeDuration(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function assertCountFields(data: Record<string, unknown>): void {
  for (const key of EXECUTION_COUNT_KEYS) {
    if (data[key] !== undefined && !isNonNegativeCount(data[key])) {
      contractError("AI 问答进度事件包含不支持的数据。");
    }
  }
  for (const key of EXECUTION_DURATION_KEYS) {
    if (data[key] !== undefined && !isNonNegativeDuration(data[key])) {
      contractError("AI 问答进度事件包含不支持的数据。");
    }
  }
}

function assertPhase(data: Record<string, unknown>): void {
  if (data["phase"] === undefined) return;
  const phase = data["phase"];
  if (typeof phase !== "string" || !EXECUTION_PHASES.has(phase)) {
    contractError("AI 问答进度事件包含不支持的阶段标识。");
  }
}

function assertStageTimings(data: Record<string, unknown>): void {
  if (data["stageTimings"] === undefined) return;
  const timings = data["stageTimings"];
  if (!isRecord(timings)) contractError("AI 问答阶段耗时事件格式无效。");
  const keys = Object.keys(timings);
  if (!keys.length || keys.some((key) => !STAGE_TIMING_KEYS.has(key))) {
    contractError("AI 问答阶段耗时事件格式无效。");
  }
  if (keys.some((key) => !isNonNegativeDuration(timings[key]))) {
    contractError("AI 问答阶段耗时事件格式无效。");
  }
}

function assertCitationIds(data: Record<string, unknown>): void {
  if (data["citationIds"] === undefined) return;
  const citations = data["citationIds"];
  if (
    !Array.isArray(citations)
    || citations.length > 20
    || citations.some((item) =>
      !isRecord(item)
      || Object.keys(item).some((key) => key !== "assetId" && key !== "fieldId")
      || !Number.isSafeInteger(item["assetId"])
      || Number(item["assetId"]) <= 0
      || (item["fieldId"] !== null && item["fieldId"] !== undefined && (
        !Number.isSafeInteger(item["fieldId"]) || Number(item["fieldId"]) <= 0
      ))
    )
  ) {
    contractError("AI 问答证据引用事件格式无效。");
  }
}

export function parseAiAskExecutionEvent(event: RemoteServerSentEvent): AiAskExecutionEvent {
  if (!["step_start", "step_complete", "step_error", "answer", "done", "keep_alive"].includes(event.event)) {
    contractError("AI 问答进度流包含未知事件。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data) as unknown;
  } catch {
    contractError("AI 问答进度事件格式无效。");
  }
  if (!isRecord(parsed)) contractError("AI 问答进度事件格式无效。");
  const allowedKeys = new Set(["request_id", "step_id", "timestamp", "message", "data"]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    contractError("AI 问答进度事件包含不支持的数据。");
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
    contractError("AI 问答进度事件格式无效。");
  }
  const data = isRecord(rawData) ? { ...rawData } : undefined;
  if (event.event === "keep_alive" && data !== undefined) {
    contractError("AI 问答 keep-alive 事件包含不支持的数据。");
  }
  if (data && Object.keys(data).some((key) => !EXECUTION_DATA_KEYS.has(key))) {
    contractError("AI 问答进度事件包含不支持的数据。");
  }
  if (event.event === "answer") {
    if (Object.keys(data || {}).some((key) => key !== "response")) {
      contractError("AI 问答答案事件包含不支持的数据。");
    }
    if (!data || !("response" in data)) contractError("AI 问答进度流缺少完整答案。");
    data["response"] = parseAiAskResponse(data["response"]);
  }
  if (event.event.startsWith("step_") && stepId === "metadata-count") {
    const intent = data?.["intent"];
    const tableCount = data?.["tableCount"];
    const reportCount = data?.["reportCount"];
    const validCountEvent = intent === "metadata_count"
      ? reportCount === undefined && (tableCount === undefined || isNonNegativeCount(tableCount))
      : intent === "report_count"
        ? tableCount === undefined && (reportCount === undefined || isNonNegativeCount(reportCount))
        : intent === "ambiguous_count" && tableCount === undefined && reportCount === undefined;
    if (!validCountEvent) contractError("AI 问答统计进度事件格式无效。");
  }
  if (event.event.startsWith("step_") && data?.["hits"] !== undefined) {
    const hits = data["hits"];
    if (!Array.isArray(hits) || hits.length > 20 || hits.some((hit) =>
      !isRecord(hit) || Object.keys(hit).some((key) => !HIT_DATA_KEYS.has(key))
    )) {
      contractError("AI 问答检索命中事件格式无效。");
    }
  }
  // 步骤级结构化校验放在专用分支之后，以保留各步骤更精确的错误语义。
  if (data && event.event.startsWith("step_")) {
    assertCountFields(data);
    assertPhase(data);
    assertStageTimings(data);
    assertCitationIds(data);
  }
  if (event.event === "done") {
    const status = data?.["status"];
    if (Object.keys(data || {}).some((key) => !DONE_DATA_KEYS.has(key))) {
      contractError("AI 问答结束事件包含不支持的数据。");
    }
    if (status !== "completed" && status !== "failed" && status !== "cancelled") {
      contractError("AI 问答结束事件状态无效。");
    }
    const stepCount = data?.["stepCount"];
    if (stepCount !== undefined && !isNonNegativeCount(stepCount)) {
      contractError("AI 问答结束事件包含不支持的数据。");
    }
    const reasonCode = data?.["reasonCode"];
    if (reasonCode !== undefined && (typeof reasonCode !== "string" || !REASON_CODE_PATTERN.test(reasonCode))) {
      contractError("AI 问答结束事件包含不支持的数据。");
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
      contractError("AI 问答进度流的请求标识不一致。");
    }
    requestId = event.requestId;
    if (status !== null) contractError("AI 问答结束后仍收到进度事件。");
    if (event.event === "keep_alive") return;
    if (event.event === "answer") {
      if (response !== null) contractError("AI 问答进度流返回了多个答案。");
      const parsed = event.data?.["response"];
      if (!parsed || typeof parsed !== "object") contractError("AI 问答进度流未返回完整答案。");
      response = parsed as AiAskResponse;
    } else if (event.event === "done") {
      if (status !== null) contractError("AI 问答进度流返回了多个结束事件。");
      status = event.data?.["status"] as AiAskExecutionStatus;
    }
    onEvent(event);
  });
  if (!response || status === null) contractError("AI 问答进度流未正常结束。");
  return { response, status };
}
