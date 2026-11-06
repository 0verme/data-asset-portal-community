import { LONG_REQUEST_TIMEOUT } from "../config/request.ts";
import { requestRemote, requestRemoteEventStream } from "./http.ts";

export type AiAskStatus =
  | "answered"
  | "partial_answer"
  | "insufficient_evidence"
  | "retrieval_unavailable"
  | "generation_unavailable"
  | "metadata_count_answered"
  | "ambiguous_scope"
  | "metadata_count_unavailable";
export type AiRetrievalStatus = "available" | "degraded" | "unavailable" | "not_run";
export type AiGenerationStatus = "completed" | "unavailable" | "disabled" | "not_run";

export interface AiAskAvailability {
  enabled: boolean;
}

export interface AiAskCandidate {
  assetId: number;
  fieldId?: number | null;
  assetType: "table" | "field";
  tableName: string;
  tableDisplayName: string;
  tableDescription: string;
  fieldName?: string | null;
  fieldDisplayName?: string | null;
  fieldDescription?: string | null;
  domain: string;
  layer: string;
  source: "dap_catalog";
  matchReason: string;
  relevance: "direct" | "related";
}

export interface AiAskCitation {
  assetId: number;
  fieldId?: number | null;
  source: "dap_catalog";
}

export type AiAskProgressStepId =
  | "analyzing"
  | "retrieving"
  | "counting"
  | "organizing"
  | "generating"
  | "completed";
export type AiAskProgressStatus = "pending" | "running" | "completed" | "failed";
export type AiAskProgressIntent = "metadata_count";

export interface AiAskProgressStep {
  id: AiAskProgressStepId;
  status: AiAskProgressStatus;
  intent?: AiAskProgressIntent | null;
  elapsedMs: number;
  tableCount?: number | null;
  fieldCount?: number | null;
  errorCode?: "timeout" | "unavailable" | "invalid_response" | "disabled" | "cancelled" | null;
}

export interface AiAskStatisticalFilter {
  dimension: string;
  value: string | number;
  displayName?: string;
}

/** Presentation-only shape derived from the authoritative metadataCount. */
export interface AiAskStatisticalResult {
  metric: string;
  value: number;
  filters: AiAskStatisticalFilter[];
  source: "dap_catalog";
  complete: boolean;
  sourceLink?: string | null;
}
export interface AiMetadataCountFilter {
  code: string;
  displayName: string;
  matchedAs: "catalog_value" | "catalog_alias";
  inferred: boolean;
}

export interface AiMetadataCount {
  metric: "table_count";
  value: number;
  filters: {
    domain: AiMetadataCountFilter | null;
    layer: AiMetadataCountFilter | null;
  };
  source: "dap_catalog";
  complete: true;
  catalogProfile: "internal" | "strict" | "disabled";
  sourceLink: string;
}

export interface AiAskResponse {
  status: AiAskStatus;
  answer: string;
  citations: AiAskCitation[];
  candidates: AiAskCandidate[];
  metadataCount: AiMetadataCount | null;
  retrievalStatus: AiRetrievalStatus;
  generationStatus: AiGenerationStatus;
  resultsTruncated: boolean;
  reasonCode?: string | null;
  elapsedMs: number;
  statisticalResult?: AiAskStatisticalResult;
}

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

const AI_ASK_TIMEOUT_MS = LONG_REQUEST_TIMEOUT;
const RETRIEVAL_STATUSES = new Set<string>(["available", "degraded", "unavailable", "not_run"]);
const GENERATION_STATUSES = new Set<string>(["completed", "unavailable", "disabled", "not_run"]);
const ASK_STATUSES = new Set<string>([
  "answered",
  "partial_answer",
  "insufficient_evidence",
  "retrieval_unavailable",
  "generation_unavailable",
  "metadata_count_answered",
  "ambiguous_scope",
  "metadata_count_unavailable",
]);
const PROGRESS_STEP_IDS = new Set<string>([
  "analyzing", "retrieving", "counting", "organizing", "generating", "completed",
]);
const PROGRESS_STATUSES = new Set<string>(["pending", "running", "completed", "failed"]);
const PROGRESS_ERRORS = new Set<string>(["timeout", "unavailable", "invalid_response", "disabled", "cancelled"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStableId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function citationKey(assetId: number, fieldId?: number | null): string {
  return `${assetId}:${fieldId ?? "table"}`;
}

function parseStatisticalResult(value: unknown): AiAskStatisticalResult | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error("Invalid AI ask statistical result.");
  const metric = value["metric"];
  const resultValue = value["value"];
  const filters = value["filters"];
  const sourceLink = value["sourceLink"];
  if (
    !isText(metric) || !metric.trim()
    || !Number.isInteger(resultValue) || Number(resultValue) < 0
    || !Array.isArray(filters) || filters.length > 20
    || value["source"] !== "dap_catalog"
    || typeof value["complete"] !== "boolean"
    || (sourceLink !== undefined && sourceLink !== null && !isText(sourceLink))
  ) {
    throw new Error("Invalid AI ask statistical result.");
  }
  const parsedFilters = filters.map((filter): AiAskStatisticalFilter => {
    if (!isRecord(filter)) throw new Error("Invalid AI ask statistical filter.");
    const dimension = filter["dimension"];
    const filterValue = filter["value"];
    const displayName = filter["displayName"];
    if (
      !isText(dimension) || !dimension.trim()
      || !(isText(filterValue) || (typeof filterValue === "number" && Number.isFinite(filterValue)))
      || (displayName !== undefined && !isText(displayName))
    ) {
      throw new Error("Invalid AI ask statistical filter.");
    }
    return {
      dimension,
      value: filterValue,
      ...(isText(displayName) ? { displayName } : {}),
    };
  });
  return {
    metric,
    value: Number(resultValue),
    filters: parsedFilters,
    source: "dap_catalog",
    complete: value["complete"],
    ...(sourceLink === undefined ? {} : { sourceLink: sourceLink as string | null }),
  };
}

function parseMetadataCountFilter(value: unknown): AiMetadataCountFilter | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error("Invalid AI metadata count filter.");
  const code = value["code"];
  const displayName = value["displayName"];
  const matchedAs = value["matchedAs"];
  const inferred = value["inferred"];
  if (
    !isText(code) || !code.trim() || code.length > 64
    || !isText(displayName) || !displayName.trim() || displayName.length > 256
    || (matchedAs !== "catalog_value" && matchedAs !== "catalog_alias")
    || typeof inferred !== "boolean"
  ) {
    throw new Error("Invalid AI metadata count filter.");
  }
  return { code, displayName, matchedAs, inferred };
}

function parseMetadataCount(value: unknown): AiMetadataCount {
  if (!isRecord(value) || !isRecord(value["filters"])) {
    throw new Error("Invalid AI metadata count evidence.");
  }
  const count = value["value"];
  const sourceLink = value["sourceLink"];
  const catalogProfile = value["catalogProfile"];
  const filters = value["filters"];
  if (
    value["metric"] !== "table_count"
    || !Number.isSafeInteger(count) || Number(count) < 0
    || value["source"] !== "dap_catalog"
    || value["complete"] !== true
    || (catalogProfile !== "internal" && catalogProfile !== "strict" && catalogProfile !== "disabled")
    || !isText(sourceLink) || !/^\/data-warehouse(?:\?.*)?$/.test(sourceLink)
    || Object.keys(filters).some((key) => key !== "domain" && key !== "layer")
  ) {
    throw new Error("Invalid AI metadata count evidence.");
  }
  return {
    metric: "table_count",
    value: Number(count),
    filters: {
      domain: parseMetadataCountFilter(filters["domain"]),
      layer: parseMetadataCountFilter(filters["layer"]),
    },
    source: "dap_catalog",
    complete: true,
    catalogProfile,
    sourceLink,
  };
}

function metadataCountToStatisticalResult(count: AiMetadataCount): AiAskStatisticalResult {
  const filters: AiAskStatisticalFilter[] = [];
  if (count.filters.domain) {
    filters.push({ dimension: "domain", value: count.filters.domain.displayName, displayName: "主题域" });
  }
  if (count.filters.layer) {
    filters.push({ dimension: "layer", value: count.filters.layer.displayName, displayName: "数据分层" });
  }
  return {
    metric: count.metric,
    value: count.value,
    filters,
    source: "dap_catalog",
    complete: count.complete,
    sourceLink: count.sourceLink,
  };
}

function parseCandidate(value: unknown): AiAskCandidate {
  if (!isRecord(value)) throw new Error("Invalid AI ask candidate.");
  const assetId = value["assetId"];
  const fieldId = value["fieldId"];
  const assetType = value["assetType"];
  const relevance = value["relevance"];
  const optionalFieldId = fieldId === undefined ? null : fieldId;
  if (
    !isStableId(assetId)
    || (optionalFieldId !== null && !isStableId(optionalFieldId))
    || (assetType !== "table" && assetType !== "field")
    || !isText(value["tableName"])
    || !value["tableName"].trim()
    || !isText(value["tableDisplayName"])
    || !isText(value["tableDescription"])
    || !isText(value["domain"])
    || !isText(value["layer"])
    || value["source"] !== "dap_catalog"
    || (relevance !== "direct" && relevance !== "related")
    || !isText(value["matchReason"])
    || !value["matchReason"].trim()
  ) {
    throw new Error("Invalid AI ask candidate.");
  }
  if (assetType === "field") {
    if (
      !isStableId(optionalFieldId)
      || !isText(value["fieldName"])
      || !value["fieldName"].trim()
      || !isText(value["fieldDisplayName"])
      || !isText(value["fieldDescription"])
    ) {
      throw new Error("Invalid AI ask field candidate.");
    }
  } else if (
    optionalFieldId !== null
    || (value["fieldName"] !== undefined && value["fieldName"] !== null)
  ) {
    throw new Error("Invalid AI ask table candidate.");
  }
  return {
    assetId,
    fieldId: optionalFieldId,
    assetType,
    tableName: value["tableName"],
    tableDisplayName: value["tableDisplayName"],
    tableDescription: value["tableDescription"],
    fieldName: isText(value["fieldName"]) ? value["fieldName"] : null,
    fieldDisplayName: isText(value["fieldDisplayName"]) ? value["fieldDisplayName"] : null,
    fieldDescription: isText(value["fieldDescription"]) ? value["fieldDescription"] : null,
    domain: value["domain"],
    layer: value["layer"],
    source: "dap_catalog",
    matchReason: value["matchReason"],
    relevance,
  };
}

export function parseAiAskAvailability(value: unknown): AiAskAvailability {
  if (!isRecord(value) || typeof value["enabled"] !== "boolean") {
    throw new Error("Invalid AI ask availability response.");
  }
  return { enabled: value["enabled"] };
}

export function parseAiAskResponse(value: unknown): AiAskResponse {
  if (!isRecord(value)) throw new Error("Invalid AI ask response.");
  const allowedKeys = new Set([
    "status", "answer", "citations", "candidates", "metadataCount", "statisticalResult",
    "retrievalStatus", "generationStatus", "resultsTruncated", "reasonCode", "elapsedMs",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Unexpected data in AI ask response.");
  }
  const status = value["status"];
  const retrievalStatus = value["retrievalStatus"];
  const generationStatus = value["generationStatus"];
  const rawStatisticalResult = parseStatisticalResult(value["statisticalResult"]);
  const rawMetadataCount = value["metadataCount"];
  const metadataCount = rawMetadataCount === undefined || rawMetadataCount === null
    ? null
    : parseMetadataCount(rawMetadataCount);
  if (rawStatisticalResult) {
    throw new Error("statisticalResult is a presentation adapter and must be derived from metadataCount.");
  }
  const statisticalResult = metadataCount ? metadataCountToStatisticalResult(metadataCount) : null;
  const resultsTruncated = value["resultsTruncated"] ?? (metadataCount ? false : undefined);
  const answer = value["answer"] ?? (metadataCount ? "" : undefined);
  const rawCandidates = value["candidates"] ?? (metadataCount ? [] : undefined);
  const rawCitations = value["citations"] ?? (metadataCount ? [] : undefined);
  const elapsedMs = value["elapsedMs"];
  if (
    typeof status !== "string"
    || !status.trim()
    || !ASK_STATUSES.has(status)
    || typeof retrievalStatus !== "string"
    || !RETRIEVAL_STATUSES.has(retrievalStatus)
    || typeof generationStatus !== "string"
    || !GENERATION_STATUSES.has(generationStatus)
    || typeof resultsTruncated !== "boolean"
    || !isText(answer)
    || answer.length > 2000
    || !Array.isArray(rawCandidates)
    || rawCandidates.length > 20
    || !Array.isArray(rawCitations)
    || rawCitations.length > 20
    || typeof elapsedMs !== "number"
    || !Number.isFinite(elapsedMs)
    || elapsedMs < 0
  ) {
    throw new Error("Invalid AI ask response.");
  }
  const candidates = rawCandidates.map(parseCandidate);
  const candidateIds = new Set(candidates.map((item) => citationKey(item.assetId, item.fieldId)));
  const citations = rawCitations.map((citation): AiAskCitation => {
    if (!isRecord(citation)) throw new Error("Invalid AI ask citation.");
    const assetId = citation["assetId"];
    const fieldId = citation["fieldId"] === undefined ? null : citation["fieldId"];
    if (
      !isStableId(assetId)
      || (fieldId !== null && !isStableId(fieldId))
      || citation["source"] !== "dap_catalog"
      || !candidateIds.has(citationKey(assetId, fieldId as number | null))
    ) {
      throw new Error("Invalid AI ask citation.");
    }
    return { assetId, fieldId: fieldId as number | null, source: "dap_catalog" };
  });
  const citationIds = citations.map((item) => citationKey(item.assetId, item.fieldId));
  if (new Set(citationIds).size !== citationIds.length) {
    throw new Error("Duplicate AI ask citation.");
  }
  if (resultsTruncated && status !== "partial_answer" && !statisticalResult) {
    throw new Error("Truncated AI results must use an explicit partial-answer status.");
  }
  if (status === "metadata_count_answered") {
    if (
      !metadataCount || !metadataCount.complete
      || retrievalStatus !== "not_run" || generationStatus !== "not_run"
      || candidates.length || citations.length || resultsTruncated
    ) {
      throw new Error("Metadata count answer must contain exact count evidence only.");
    }
  } else if (status === "ambiguous_scope" || status === "metadata_count_unavailable") {
    if (
      metadataCount || statisticalResult
      || retrievalStatus !== "not_run" || generationStatus !== "not_run"
      || candidates.length || citations.length || resultsTruncated
    ) {
      throw new Error("Unresolved metadata count must not contain count values or citations.");
    }
  } else if (metadataCount) {
    throw new Error("Non-count AI responses must not contain metadata count evidence.");
  }
  if (status === "answered" || status === "partial_answer") {
    if (!citations.length || generationStatus !== "completed") {
      throw new Error("Answered AI response must contain verified citations.");
    }
  } else if (!statisticalResult && (citations.length || candidates.length)) {
    throw new Error("Unanswered AI response must not contain answer candidates or citations.");
  }
  if (citations.length || candidates.length) {
    const citationIds = new Set(citations.map((item) => citationKey(item.assetId, item.fieldId)));
    if (
      candidateIds.size !== candidates.length
      || candidateIds.size !== citationIds.size
      || [...candidateIds].some((identity) => !citationIds.has(identity))
    ) {
      throw new Error("AI answer candidates must exactly match its verified citations.");
    }
  }
  if (status === "answered" && !statisticalResult && !candidates.some((item) => item.relevance === "direct")) {
    throw new Error("Answered AI response must contain directly relevant evidence.");
  }
  return {
    status: status as AiAskStatus,
    answer,
    citations,
    candidates,
    metadataCount,
    retrievalStatus: retrievalStatus as AiRetrievalStatus,
    generationStatus: generationStatus as AiGenerationStatus,
    resultsTruncated,
    reasonCode: isText(value["reasonCode"]) ? value["reasonCode"] : null,
    elapsedMs,
    ...(statisticalResult ? { statisticalResult } : {}),
  };
}

export function parseAiAskProgressStep(value: unknown): AiAskProgressStep {
  if (!isRecord(value)) throw new Error("Invalid AI ask progress event.");
  const allowedKeys = new Set(["id", "status", "intent", "elapsedMs", "tableCount", "fieldCount", "errorCode"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Unexpected data in AI ask progress event.");
  }
  const id = value["id"];
  const status = value["status"];
  const intent = value["intent"];
  const elapsedMs = value["elapsedMs"];
  const tableCount = value["tableCount"];
  const fieldCount = value["fieldCount"];
  const errorCode = value["errorCode"];
  if (
    typeof id !== "string" || !PROGRESS_STEP_IDS.has(id)
    || typeof status !== "string" || !PROGRESS_STATUSES.has(status)
    || (intent !== undefined && intent !== null && intent !== "metadata_count")
    || (elapsedMs !== undefined && (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0))
    || (tableCount !== undefined && tableCount !== null && (!Number.isInteger(tableCount) || Number(tableCount) < 0))
    || (fieldCount !== undefined && fieldCount !== null && (!Number.isInteger(fieldCount) || Number(fieldCount) < 0))
    || (errorCode !== undefined && errorCode !== null && (typeof errorCode !== "string" || !PROGRESS_ERRORS.has(errorCode)))
  ) {
    throw new Error("Invalid AI ask progress event.");
  }
  return {
    id: id as AiAskProgressStepId,
    status: status as AiAskProgressStatus,
    ...(intent === undefined ? {} : { intent: intent as AiAskProgressIntent | null }),
    elapsedMs: typeof elapsedMs === "number" ? elapsedMs : 0,
    ...(tableCount === undefined ? {} : { tableCount: tableCount as number | null }),
    ...(fieldCount === undefined ? {} : { fieldCount: fieldCount as number | null }),
    ...(errorCode === undefined ? {} : { errorCode: errorCode as Exclude<AiAskProgressStep["errorCode"], undefined> }),
  };
}

export async function getAiAskAvailability(): Promise<AiAskAvailability> {
  if (typeof import.meta.env !== "undefined" && import.meta.env.VITE_API_MODE === "mock") return { enabled: true };
  if (API_MODE !== "remote") return { enabled: false };
  const response = await requestRemote<unknown>("/ai/status", {
    timeout: 5_000,
    suppressUnauthorizedEvent: true,
  });
  return parseAiAskAvailability(response);
}

export async function askAiWithProgress(
  query: string,
  onProgress: (step: AiAskProgressStep) => void,
  scope = "all",
  topK = 10,
  signal?: AbortSignal,
): Promise<AiAskResponse> {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery || normalizedQuery.length > 500) {
    throw new Error("问题长度必须为 1–500 个字符。");
  }
  if (typeof import.meta.env !== "undefined" && import.meta.env.VITE_API_MODE === "mock") {
    const { askMockAiWithProgress } = await import("../mock/aiAsk.ts");
    return askMockAiWithProgress(normalizedQuery, onProgress, topK, signal);
  }
  if (API_MODE !== "remote") {
    return parseAiAskResponse({
      status: "generation_unavailable",
      answer: "AI 问答暂不可用，请稍后重试。",
      citations: [], candidates: [], retrievalStatus: "not_run",
      generationStatus: "disabled", resultsTruncated: false,
      reasonCode: "ai_disabled", elapsedMs: 0,
    });
  }

  let result: AiAskResponse | null = null;
  await requestRemoteEventStream("/ai/ask/progress", {
    method: "POST",
    body: { query: normalizedQuery, scope, topK },
    timeout: AI_ASK_TIMEOUT_MS,
    suppressUnauthorizedEvent: true,
    suppressTimeoutPayloadLogging: true,
    signal,
  }, (event) => {
    if (event.event === "progress") {
      onProgress(parseAiAskProgressStep(JSON.parse(event.data) as unknown));
    } else if (event.event === "result") {
      if (result !== null) throw new Error("AI ask returned more than one final result.");
      result = parseAiAskResponse(JSON.parse(event.data) as unknown);
    }
  });
  if (result === null) throw new Error("AI 问答进度流未返回完整答案。");
  return result;
}

export async function askAi(
  query: string,
  scope = "all",
  topK = 10,
): Promise<AiAskResponse> {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery || normalizedQuery.length > 500) {
    throw new Error("问题长度必须为 1–500 个字符。");
  }
  if (typeof import.meta.env !== "undefined" && import.meta.env.VITE_API_MODE === "mock") {
    const { createMockAiAnswer } = await import("../mock/aiAsk.ts");
    return createMockAiAnswer(normalizedQuery, topK);
  }
  if (API_MODE !== "remote") {
    return {
      status: "generation_unavailable",
      answer: "AI 问答暂不可用，请稍后重试。",
      citations: [],
      candidates: [],
      metadataCount: null,
      retrievalStatus: "not_run",
      generationStatus: "disabled",
      resultsTruncated: false,
      reasonCode: "ai_disabled",
      elapsedMs: 0,
    };
  }
  const response = await requestRemote<unknown>("/ai/ask", {
    method: "POST",
    body: { query: normalizedQuery, scope, topK },
    timeout: AI_ASK_TIMEOUT_MS,
    suppressUnauthorizedEvent: true,
    suppressTimeoutPayloadLogging: true,
  });
  return parseAiAskResponse(response);
}
