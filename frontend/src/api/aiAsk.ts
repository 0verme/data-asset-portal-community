import { LONG_REQUEST_TIMEOUT } from "../config/request.ts";
import { requestRemote, requestRemoteEventStream } from "./http.ts";

export type AiAskStatus =
  | "answered"
  | "insufficient_evidence"
  | "retrieval_unavailable"
  | "generation_unavailable";
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

export interface AiAskProgressStep {
  id: AiAskProgressStepId;
  status: AiAskProgressStatus;
  elapsedMs: number;
  tableCount?: number | null;
  fieldCount?: number | null;
  errorCode?: "timeout" | "unavailable" | "invalid_response" | "disabled" | "cancelled" | null;
}

export interface AiAskResponse {
  status: AiAskStatus;
  answer: string;
  citations: AiAskCitation[];
  candidates: AiAskCandidate[];
  retrievalStatus: AiRetrievalStatus;
  generationStatus: AiGenerationStatus;
  reasonCode?: string | null;
  elapsedMs: number;
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
  "insufficient_evidence",
  "retrieval_unavailable",
  "generation_unavailable",
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

function parseCandidate(value: unknown): AiAskCandidate {
  if (!isRecord(value)) throw new Error("Invalid AI ask candidate.");
  const assetId = value["assetId"];
  const fieldId = value["fieldId"];
  const assetType = value["assetType"];
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
  const status = value["status"];
  const retrievalStatus = value["retrievalStatus"];
  const generationStatus = value["generationStatus"];
  const answer = value["answer"];
  const rawCandidates = value["candidates"];
  const rawCitations = value["citations"];
  const elapsedMs = value["elapsedMs"];
  if (
    typeof status !== "string"
    || !ASK_STATUSES.has(status)
    || typeof retrievalStatus !== "string"
    || !RETRIEVAL_STATUSES.has(retrievalStatus)
    || typeof generationStatus !== "string"
    || !GENERATION_STATUSES.has(generationStatus)
    || !isText(answer)
    || answer.length > 2000
    || !Array.isArray(rawCandidates)
    || rawCandidates.length > 10
    || !Array.isArray(rawCitations)
    || rawCitations.length > 10
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
  if (status === "answered" && (!citations.length || generationStatus !== "completed")) {
    throw new Error("Answered AI response must contain verified citations.");
  }
  if (status !== "answered" && citations.length) {
    throw new Error("Non-answered AI response must not contain citations.");
  }
  return {
    status: status as AiAskStatus,
    answer,
    citations,
    candidates,
    retrievalStatus: retrievalStatus as AiRetrievalStatus,
    generationStatus: generationStatus as AiGenerationStatus,
    reasonCode: isText(value["reasonCode"]) ? value["reasonCode"] : null,
    elapsedMs,
  };
}

export function parseAiAskProgressStep(value: unknown): AiAskProgressStep {
  if (!isRecord(value)) throw new Error("Invalid AI ask progress event.");
  const allowedKeys = new Set(["id", "status", "elapsedMs", "tableCount", "fieldCount", "errorCode"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Unexpected data in AI ask progress event.");
  }
  const id = value["id"];
  const status = value["status"];
  const elapsedMs = value["elapsedMs"];
  const tableCount = value["tableCount"];
  const fieldCount = value["fieldCount"];
  const errorCode = value["errorCode"];
  if (
    typeof id !== "string" || !PROGRESS_STEP_IDS.has(id)
    || typeof status !== "string" || !PROGRESS_STATUSES.has(status)
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
    elapsedMs: typeof elapsedMs === "number" ? elapsedMs : 0,
    ...(tableCount === undefined ? {} : { tableCount: tableCount as number | null }),
    ...(fieldCount === undefined ? {} : { fieldCount: fieldCount as number | null }),
    ...(errorCode === undefined ? {} : { errorCode: errorCode as Exclude<AiAskProgressStep["errorCode"], undefined> }),
  };
}

export async function getAiAskAvailability(): Promise<AiAskAvailability> {
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
  if (API_MODE !== "remote") {
    return parseAiAskResponse({
      status: "generation_unavailable",
      answer: "AI 问答暂不可用，请稍后重试。",
      citations: [], candidates: [], retrievalStatus: "not_run",
      generationStatus: "disabled", reasonCode: "ai_disabled", elapsedMs: 0,
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
  if (API_MODE !== "remote") {
    return {
      status: "generation_unavailable",
      answer: "AI 问答暂不可用，请稍后重试。",
      citations: [],
      candidates: [],
      retrievalStatus: "not_run",
      generationStatus: "disabled",
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
