import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/index.ts";
import type { AiAskExecutionEvent, AiAskExecutionStatus } from "../api/aiAskExecution.ts";
import { receivedTerminalEvent } from "../api/aiAskExecutionSummary.ts";
import { StepDetail } from "./StepDetail.tsx";
import { StepSummary } from "./StepSummary.tsx";
import { formatSafeAiAskDiagnostics } from "./aiAskExecutionDiagnostics.ts";
import { groupSteps, type AiAskRawStep } from "./aiAskStepSummary.ts";
import "../styles/aiAskExecution.css";

interface AiAskExecutionPanelProps {
  events: AiAskExecutionEvent[];
  status: AiAskExecutionStatus | null;
  runId: number;
  loading: boolean;
  citationCount: number;
  query: string;
  onCancel: () => void;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function AiAskExecutionPanel({ events, status, runId, loading, citationCount, query, onCancel }: AiAskExecutionPanelProps) {
  const { t } = useTranslation("aiAsk");
  const [expanded, setExpanded] = useState(status === "running");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "copyFailed" | "">("");
  const previousRun = useRef(runId);
  const previousStatus = useRef(status);

  useEffect(() => {
    if (runId !== previousRun.current) {
      previousRun.current = runId;
      setDetailsExpanded(false);
      setCopyFeedback("");
      setExpanded(true);
    }
  }, [runId]);

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous === "running" && status === "completed") {
      setExpanded(false);
    }
  }, [status]);

  const steps = useMemo<AiAskRawStep[]>(() => {
    const byId = new Map<string, AiAskRawStep>();
    for (const event of events) {
      if (event.event !== "step_start" && event.event !== "step_complete" && event.event !== "step_error") continue;
      const data = record(event.data);
      const prior = byId.get(event.stepId);
      const nextStatus: AiAskRawStep["status"] = event.event === "step_error"
        ? "failed"
        : event.event === "step_complete" ? "completed" : "running";
      byId.set(event.stepId, {
        id: event.stepId,
        status: nextStatus,
        message: event.message,
        data: { ...(prior?.data || {}), ...data },
        timestamp: event.timestamp,
      });
    }
    return [...byId.values()];
  }, [events]);

  if (!status && !events.length) return null;
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  const backendTerminated = receivedTerminalEvent(events);
  const overallLabel = status === "running" ? t("execution.running")
    : status === "completed" ? t("execution.completed", { count: steps.filter((step) => step.status === "completed").length })
      : status === "cancelled" ? t("execution.cancelled")
        : backendTerminated ? t("execution.failed") : t("execution.interrupted");
  const displayedSteps = steps.map((step): AiAskRawStep => ({
    ...step,
    status: terminal && step.status === "running"
      ? status === "completed" ? "completed" : "failed"
      : step.status,
  }));
  const groupedStages = groupSteps(displayedSteps);
  const verification = groupedStages.find((stage) => stage.id === "verification");
  const verifiedParts: string[] = [];
  if (verification?.verifiedTableCount !== null && verification?.verifiedTableCount !== undefined) {
    verifiedParts.push(t("execution.summary.verifiedTables", { count: verification.verifiedTableCount }));
  }
  if (verification?.verifiedFieldCount !== null && verification?.verifiedFieldCount !== undefined) {
    verifiedParts.push(t("execution.summary.verifiedFields", { count: verification.verifiedFieldCount }));
  }
  const completedSummary = verifiedParts.length
    ? t("execution.summary.completedVerified", { parts: verifiedParts.join(" · ") })
    : t("execution.summary.completedWithoutCounts");
  const collapsedSummary = citationCount > 0
    ? `${completedSummary} · ${t("execution.summary.sourcesTraceable")}`
    : completedSummary;
  const completedAndCollapsed = status === "completed" && !expanded;

  const copyDiagnostics = async (): Promise<void> => {
    setCopyFeedback("");
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(formatSafeAiAskDiagnostics(events, status, query));
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("copyFailed");
    }
  };

  return (
    <div className="sp-ai-execution-shell">
      <details
        className={`sp-ai-execution sp-ai-execution-${status || "running"}`}
        open={status === "running" || expanded}
        onToggle={(event) => {
          if (event.target !== event.currentTarget) return;
          if (status === "running") {
            setExpanded(true);
            return;
          }
          setExpanded(event.currentTarget.open);
        }}
        aria-label={t("execution.ariaLabel")}
      >
        <summary
          className={`sp-ai-execution-summary${completedAndCollapsed ? " is-collapsed" : ""}`}
          onClick={(event) => {
            if (status === "running") event.preventDefault();
          }}
        >
          {completedAndCollapsed ? (
            <>
              <span className="sp-ai-execution-collapsed-summary">{collapsedSummary}</span>
              <span className="sp-ai-execution-details-link">{t("execution.details")}</span>
            </>
          ) : (
            <>
              <span>{t("execution.title")}</span>
              <span className="sp-ai-execution-overall">{overallLabel}</span>
            </>
          )}
        </summary>
        {status === "failed" && !backendTerminated ? (
          <p className="sp-ai-execution-note" role="status">
            {t("execution.missingTerminalEvent")}
          </p>
        ) : null}
        {steps.length ? (
          <>
            <StepSummary steps={displayedSteps} />
            <details
              className="sp-ai-execution-details"
              key={runId}
              open={detailsExpanded}
              onToggle={(event) => {
                if (event.target === event.currentTarget) setDetailsExpanded(event.currentTarget.open);
              }}
            >
              <summary>{detailsExpanded ? t("execution.hideFullSteps") : t("execution.fullSteps")}</summary>
              <StepDetail steps={displayedSteps} />
            </details>
          </>
        ) : <p className="sp-ai-execution-waiting" role="status">{t("execution.noSteps")}</p>}
        {loading ? (
          <Button variant="tertiary" type="button" className="sp-ai-execution-cancel" onClick={onCancel}>
            {t("execution.cancel")}
          </Button>
        ) : null}
      </details>
      <div className="sp-ai-execution-actions">
        <Button variant="tertiary" type="button" onClick={() => void copyDiagnostics()}>
          {t("execution.copyDebug")}
        </Button>
        {copyFeedback ? <span className="sp-ai-execution-copy-feedback" role="status">{t(`execution.${copyFeedback}`)}</span> : null}
      </div>
    </div>
  );
}
