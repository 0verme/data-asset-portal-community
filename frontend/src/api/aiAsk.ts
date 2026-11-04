import { LONG_REQUEST_TIMEOUT } from "../config/request.ts";
import { requestRemote } from "./http.ts";

export type AiAskStatus =
  | "answered"
  | "partial_answer"
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
  relevance: "direct" | "related";
}

export interface AiAskCitation {
  assetId: number;
  fieldId?: number | null;
  source: "dap_catalog";
}

export interface AiAskResponse {
  status: AiAskStatus;
  answer: string;
  citations: AiAskCitation[];
  candidates: AiAskCandidate[];
  retrievalStatus: AiRetrievalStatus;
  generationStatus: AiGenerationStatus;
  resultsTruncated: boolean;
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
  "partial_answer",
  "insufficient_evidence",
  "retrieval_unavailable",
  "generation_unavailable",
]);

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
  const status = value["status"];
  const retrievalStatus = value["retrievalStatus"];
  const generationStatus = value["generationStatus"];
  const resultsTruncated = value["resultsTruncated"];
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
  if (resultsTruncated && status !== "partial_answer") {
    throw new Error("Truncated AI results must use an explicit partial-answer status.");
  }
  if (status === "answered" || status === "partial_answer") {
    if (!citations.length || generationStatus !== "completed") {
      throw new Error("Answered AI response must contain verified citations.");
    }
    const citationIds = new Set(citations.map((item) => citationKey(item.assetId, item.fieldId)));
    if (
      candidateIds.size !== candidates.length
      || candidateIds.size !== citationIds.size
      || [...candidateIds].some((identity) => !citationIds.has(identity))
    ) {
      throw new Error("AI answer candidates must exactly match its verified citations.");
    }
    if (status === "answered" && !candidates.some((item) => item.relevance === "direct")) {
      throw new Error("Answered AI response must contain directly relevant evidence.");
    }
  } else if (citations.length || candidates.length) {
    throw new Error("Unanswered AI response must not contain answer candidates or citations.");
  }
  return {
    status: status as AiAskStatus,
    answer,
    citations,
    candidates,
    retrievalStatus: retrievalStatus as AiRetrievalStatus,
    generationStatus: generationStatus as AiGenerationStatus,
    resultsTruncated,
    reasonCode: isText(value["reasonCode"]) ? value["reasonCode"] : null,
    elapsedMs,
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
