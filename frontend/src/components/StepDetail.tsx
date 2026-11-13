import { useTranslation } from "react-i18next";
import type { AiAskRawStep } from "./aiAskStepSummary.ts";
import { requestCountEvidence } from "../api/aiAskExecutionSummary.ts";
import type { TFunction } from "i18next";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function displayList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const ERROR_LABEL_KEYS = {
  timeout: "timeout",
  unavailable: "unavailable",
  invalid_response: "invalid_response",
  invalid_plan: "invalid_plan",
  invalid_model_output: "invalid_model_output",
  invalid_citation: "invalid_citation",
  visibility_unavailable: "visibility_unavailable",
  asset_verification_unavailable: "asset_verification_unavailable",
  field_not_found: "field_not_found",
  not_found: "not_found",
  service_auth_not_configured: "service_auth_not_configured",
  service_unauthorized: "service_unauthorized",
  busy: "busy",
  disabled: "disabled",
  llm_timeout: "llm_timeout",
  llm_busy: "llm_busy",
  llm_unavailable: "llm_unavailable",
  llm_not_configured: "llm_not_configured",
  llm_daily_quota_exceeded: "llm_daily_quota_exceeded",
  llm_quota_unavailable: "llm_quota_unavailable",
  ai_disabled: "ai_disabled",
  ambiguous_scope: "ambiguous_scope",
  metadata_count_unavailable: "metadata_count_unavailable",
} as const;

function errorLabel(value: unknown, t: TFunction<"aiAsk">): string {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(ERROR_LABEL_KEYS, value)) {
    return t("execution.detail.genericStepError");
  }
  const key = ERROR_LABEL_KEYS[value as keyof typeof ERROR_LABEL_KEYS];
  return t(`execution.detail.errors.${key}`);
}

function stepLabel(id: string, message: string, t: TFunction<"aiAsk">): string {
  if (message) return message;
  if (id === "metadata-count") return t("execution.detail.stepMetadataCount");
  if (id === "planning") return t("execution.detail.stepPlanning");
  if (id.startsWith("rag-round-")) return t("execution.detail.stepRetrieval");
  if (id === "merge") return t("execution.detail.stepMerge");
  if (id === "verification") return t("execution.detail.stepVerification");
  if (id === "generating") return t("execution.detail.stepGenerating");
  return t("execution.detail.step");
}

function StepDetails({ step }: { step: AiAskRawStep }) {
  const { t } = useTranslation("aiAsk");
  const data = step.data || {};
  const queries = displayList(data["queries"]);
  const concepts = displayList(data["keyConcepts"]);
  const hits = Array.isArray(data["hits"])
    ? data["hits"].map(record).filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const channels = displayList(data["channelsUsed"]);
  const fallback = typeof data["fallbackReason"] === "string" ? data["fallbackReason"] : null;
  const effectiveMode = typeof data["effectiveMode"] === "string" ? data["effectiveMode"] : null;
  const requestedMode = typeof data["requestedMode"] === "string" ? data["requestedMode"] : null;
  const retrievedCount = numberValue(data["resultCount"]);
  const verifiedCount = numberValue(data["verifiedCount"]);
  const { reported: requestCountReported, count: requestCount } = requestCountEvidence(data);
  const requestCountLabel = requestCountReported && requestCount !== null
    ? t("execution.detail.httpRequestCount", { count: requestCount })
    : t("execution.detail.requestCountUnreported");
  const searchNote = step.id.startsWith("search-")
    ? !requestCountReported
      ? t("execution.detail.requestCountUnreportedNote")
      : requestCount === 0 ? t("execution.detail.noRagRequestNote") : null
    : null;
  const deduplicatedCount = numberValue(data["deduplicatedCount"]);
  const selectedIds = Array.isArray(data["selectedAssetIds"])
    ? data["selectedAssetIds"].filter((item): item is number => typeof item === "number")
    : [];

  if (step.id === "metadata-count") {
    const intent = data["intent"];
    const reportCount = numberValue(data["reportCount"]);
    const tableCount = numberValue(data["tableCount"]);
    const count = intent === "report_count" ? reportCount : tableCount;
    const unit = t(intent === "report_count" ? "execution.detail.metadataReportUnit" : "execution.detail.metadataTableUnit", { count: count ?? 0 });
    return (
      <div className="sp-ai-execution-detail">
        {count !== null
          ? <p>{t("execution.detail.metadataExactCount", { count, unit })}</p>
          : step.status === "running"
            ? <p>{t("execution.detail.metadataChecking")}</p>
            : <p>{t("execution.detail.metadataMissing")}</p>}
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"], t)}</p> : null}
      </div>
    );
  }
  if (step.id === "planning") {
    return (
      <div className="sp-ai-execution-detail">
        {concepts.length ? <p><strong>{t("execution.detail.identifiedConcepts")}</strong>{concepts.join(t("listSeparator"))}</p> : null}
        {queries.length ? (
          <div><strong>{t("execution.detail.candidateQueries")}</strong><ol>{queries.map((query, index) => <li key={`${query}-${index}`}>{query}</li>)}</ol></div>
        ) : null}
        {fallback ? <p className="sp-ai-execution-note">{t("execution.detail.planningFallback", { reason: errorLabel(fallback, t) })}</p> : null}
        {data["planningMode"] === "exact_identifier" ? <p>{t("execution.detail.exactIdentifier")}</p> : null}
      </div>
    );
  }
  if (step.id.startsWith("search-")) {
    const query = typeof data["query"] === "string" ? data["query"] : "";
    return (
      <div className="sp-ai-execution-detail">
        {query ? <p><strong>{t("execution.detail.query")}</strong>{query}</p> : null}
        <p><strong>{t("execution.detail.strategy")}</strong>{effectiveMode || requestedMode || t("execution.detail.noStrategy")}{requestedMode && effectiveMode && requestedMode !== effectiveMode ? t("execution.detail.requestedMode", { mode: requestedMode }) : ""}</p>
        {channels.length ? <p><strong>{t("execution.detail.channels")}</strong>{channels.join(t("listSeparator"))}</p> : null}
        <p><strong>{t("execution.detail.results")}</strong>{t("execution.detail.retrievedAndVerified", { retrieved: retrievedCount ?? 0, verified: verifiedCount ?? hits.length, count: retrievedCount ?? 0 })}</p>
        {searchNote ? <p className="sp-ai-execution-note">{searchNote}</p> : null}
        {hits.length ? (
          <details className="sp-ai-execution-nested">
            <summary>{t("execution.detail.viewHits", { count: hits.length })}</summary>
            <ul>
              {hits.map((hit, index) => {
                const entity = hit["entityType"] === "field" ? t("execution.detail.field") : t("execution.detail.table");
                const name = typeof hit["name"] === "string" ? hit["name"] : t("execution.detail.asset");
                const assetId = hit["assetId"];
                const fieldId = hit["fieldId"];
                const hitTerms = displayList(hit["matchedTerms"]);
                const hitChannels = displayList(hit["retrievalChannels"]);
                return (
                  <li key={`${String(assetId)}-${String(fieldId)}-${index}`}>
                    <span>{entity}: {name} ({t("execution.detail.assetId", { id: String(assetId) })}{fieldId ? ` · ${t("execution.detail.fieldId", { id: String(fieldId) })}` : ""})</span>
                    {hitChannels.length ? <small>{t("execution.detail.channel")}{hitChannels.join(t("listSeparator"))}</small> : null}
                    {hitTerms.length ? <small>{t("execution.detail.matchEvidence")}{hitTerms.slice(0, 4).join(t("listSeparator"))}</small> : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"], t)}</p> : null}
      </div>
    );
  }
  if (step.id === "merge") {
    return (
      <div className="sp-ai-execution-detail">
        <p>{requestCountLabel} · {t("execution.detail.retrievalRounds", { count: numberValue(data["retrievalRounds"]) ?? 0 })}</p>
        <p>{t("execution.detail.deduplicatedCandidates", { count: deduplicatedCount ?? 0 })}</p>
        {selectedIds.length ? <p>{t("execution.detail.candidateIds")}{selectedIds.join(t("listSeparator"))}</p> : null}
        {typeof data["fusionMethod"] === "string" ? <p>{t("execution.detail.rankingFusion")}</p> : null}
      </div>
    );
  }
  if (step.id === "verification" || step.id.startsWith("asset-") || step.id.startsWith("field-")) {
    const table = typeof data["tableName"] === "string" ? data["tableName"] : null;
    const field = typeof data["fieldName"] === "string" ? data["fieldName"] : null;
    const source = data["source"] === "dap_authoritative_metadata";
    const verifiedTables = numberValue(data["verifiedTableCount"]);
    const verifiedFields = numberValue(data["verifiedFieldCount"] ?? 0) ?? 0;
    const fieldCount = numberValue(data["fieldCount"]);
    return (
      <div className="sp-ai-execution-detail">
        {table ? <p><strong>{t("execution.detail.verifiedAsset")}</strong>{table}</p> : null}
        {field ? <p><strong>{t("execution.detail.verifiedField")}</strong>{field}</p> : null}
        {verifiedTables !== null ? <p>{t("execution.detail.verifiedDetails", { tables: verifiedTables, fields: verifiedFields, count: verifiedTables })}</p> : null}
        {fieldCount !== null && step.id.startsWith("asset-") ? <p>{t("execution.detail.assetFieldDetails", { count: fieldCount })}</p> : null}
        {source ? <p>{t("execution.detail.authoritativeEvidence")}</p> : null}
        {data["indexEvidenceOnly"] === true ? <p className="sp-ai-execution-note">{t("execution.detail.indexEvidenceOnly")}</p> : null}
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"], t)}</p> : null}
      </div>
    );
  }
  if (step.id.startsWith("rag-round-")) {
    const queryCount = numberValue(data["queryCount"]) ?? 0;
    return (
      <div className="sp-ai-execution-detail">
        <p>{t("execution.detail.roundSummary", { queries: queryCount, requestCount: requestCountLabel, results: retrievedCount ?? 0, count: queryCount })}</p>
        {typeof data["supplementalQuery"] === "string" ? <p>{t("execution.detail.supplementalQuery")}{data["supplementalQuery"]}</p> : null}
      </div>
    );
  }
  if (step.id === "generating") {
    const evidenceCount = numberValue(data["evidenceCount"]) ?? 0;
    return (
      <div className="sp-ai-execution-detail">
        <p>{t("execution.detail.verifiedEvidence", { count: evidenceCount })}</p>
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"], t)}</p> : null}
      </div>
    );
  }
  return null;
}

export function StepDetail({ steps }: { steps: readonly AiAskRawStep[] }) {
  const { t } = useTranslation("aiAsk");
  return (
    <ol className="sp-ai-execution-list">
      {steps.map((step) => (
        <li className={`sp-ai-execution-step sp-ai-execution-step-${step.status}`} key={step.id}>
          <span className="sp-ai-execution-marker" aria-hidden="true" />
          <div className="sp-ai-execution-step-body">
            <div className="sp-ai-execution-step-head">
              <strong>{stepLabel(step.id, step.message || "", t)}</strong>
              <span>{t(step.status === "running" ? "execution.detail.statusRunning" : step.status === "completed" ? "execution.detail.statusCompleted" : "execution.detail.statusFailed")}</span>
            </div>
            <StepDetails step={step} />
          </div>
        </li>
      ))}
    </ol>
  );
}
