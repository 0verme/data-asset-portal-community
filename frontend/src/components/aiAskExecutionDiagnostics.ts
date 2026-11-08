import type { AiAskExecutionEvent, AiAskExecutionStatus } from "../api/aiAskExecution.ts";

const MAX_EVENTS = 200;
const COUNT_KEYS = [
  "stepCount", "round", "queryCount", "maxRequests", "requestCount", "resultCount",
  "verifiedCount", "retrievalRounds", "deduplicatedCount", "maxTables", "candidateCount",
  "verifiedTableCount", "verifiedFieldCount", "errorCount", "fieldCount", "evidenceCount",
  "selectedEvidenceCount", "tableCount", "candidateAssetCount", "candidateFieldCount",
  "databaseCallCount", "verifiedAssetCount",
] as const;
const DURATION_KEYS = ["durationMs", "elapsedMs"] as const;
const STAGE_TIMING_KEYS = ["httpSearchMs", "catalogValidationMs"] as const;
const SAFE_DIAGNOSTIC_CODES = new Set([
  "ai_disabled", "ambiguous_scope", "asset_verification_unavailable", "busy", "cancelled",
  "disabled", "empty_query", "field_not_found", "insufficient_evidence", "invalid_detail",
  "invalid_plan", "invalid_request", "invalid_response", "llm_busy", "llm_timeout",
  "llm_unavailable", "metadata_count_unavailable", "model_mismatch", "not_found", "partial_results",
  "service_auth_not_configured", "service_unavailable", "service_unauthorized", "timeout",
  "unavailable", "visibility_unavailable", "index_not_ready",
]);
const VALID_EVENTS = new Set(["step_start", "step_complete", "step_error", "answer", "done", "keep_alive"]);
const VALID_STATUSES = new Set(["running", "completed", "failed", "cancelled"]);

function normalizeStepId(id: string): string {
  if (["planning", "merge", "verification", "generating", "metadata-count", "execution"].includes(id)) {
    return id;
  }
  if (/^rag-round-\d+$/.test(id)) return "rag-round";
  if (/^search-[a-z0-9-]+$/.test(id)) return "search";
  if (/^catalog-[a-z0-9-]+$/.test(id)) return "catalog";
  if (/^asset-\d+$/.test(id)) return "asset";
  if (/^field-\d+-\d+$/.test(id)) return "field";
  if (["analyzing", "retrieving", "organizing", "answer", "done", "keep_alive"].includes(id)) return id;
  return "other";
}

function safeEventData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const safe: Record<string, unknown> = {};
  for (const key of COUNT_KEYS) {
    const value = data[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
  }
  for (const key of DURATION_KEYS) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = value;
  }
  for (const key of ["truncated", "indexEvidenceOnly"] as const) {
    if (typeof data[key] === "boolean") safe[key] = data[key];
  }
  if (typeof data["errorCode"] === "string" && SAFE_DIAGNOSTIC_CODES.has(data["errorCode"])) {
    safe["errorCode"] = data["errorCode"];
  }
  if (typeof data["reasonCode"] === "string" && SAFE_DIAGNOSTIC_CODES.has(data["reasonCode"])) {
    safe["reasonCode"] = data["reasonCode"];
  }
  if (data["phase"] === "database") safe["phase"] = "database";
  if (data["intent"] === "metadata_count") safe["intent"] = "metadata_count";
  if (data["source"] === "dap_catalog" || data["source"] === "dap_authoritative_metadata") {
    safe["source"] = data["source"];
  }
  const timings = data["stageTimings"];
  if (typeof timings === "object" && timings !== null && !Array.isArray(timings)) {
    const safeTimings: Record<string, number> = {};
    for (const key of STAGE_TIMING_KEYS) {
      const value = (timings as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) safeTimings[key] = value;
    }
    if (Object.keys(safeTimings).length) safe["stageTimings"] = safeTimings;
  }
  for (const [key, sourceKey] of [["queryCountObserved", "queries"], ["conceptCountObserved", "keyConcepts"], ["hitCountObserved", "hits"]] as const) {
    const value = data[sourceKey];
    if (Array.isArray(value)) safe[key] = value.length;
  }
  return safe;
}

/**
 * Produces copyable diagnostics from a strict allow-list. User prompts, event
 * messages, asset/field names and IDs, citations, hit terms, and arbitrary data
 * are deliberately excluded; only sanitized statuses and numeric diagnostics
 * are retained.
 */
export function formatSafeAiAskDiagnostics(
  events: readonly AiAskExecutionEvent[],
  status: AiAskExecutionStatus | null,
  query: string,
): string {
  const safeEvents = events.slice(0, MAX_EVENTS).flatMap((event) => {
    if (!VALID_EVENTS.has(event.event)) return [];
    const parsedTimestamp = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
    const timestamp = Number.isFinite(parsedTimestamp) ? new Date(parsedTimestamp).toISOString() : undefined;
    const data = safeEventData(event.data);
    return [{
      event: event.event,
      step: normalizeStepId(typeof event.stepId === "string" ? event.stepId : ""),
      ...(timestamp ? { timestamp } : {}),
      ...(Object.keys(data).length ? { data } : {}),
    }];
  });
  const requestId = events.find((event) => /^[a-f0-9-]{8,64}$/i.test(event.requestId))?.requestId;
  const diagnostics = {
    format: "dap-ai-ask-diagnostics-v1",
    status: status && VALID_STATUSES.has(status) ? status : null,
    queryLength: query.length,
    ...(requestId ? { requestId } : {}),
    eventCount: events.length,
    omittedEvents: Math.max(0, events.length - safeEvents.length),
    events: safeEvents,
  };
  return JSON.stringify(diagnostics, null, 2);
}
