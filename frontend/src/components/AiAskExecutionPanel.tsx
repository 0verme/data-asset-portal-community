import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/index.ts";
import type { AiAskExecutionEvent, AiAskExecutionStatus } from "../api/aiAskExecution.ts";
import { receivedTerminalEvent } from "../api/aiAskExecutionSummary.ts";
import { StepDetail } from "./StepDetail.tsx";
import { StepSummary } from "./StepSummary.tsx";
import { formatSafeAiAskDiagnostics } from "./aiAskExecutionDiagnostics.ts";
import {
  AI_ASK_EXECUTION_COPY,
  formatCompletedSummary,
  groupSteps,
  type AiAskRawStep,
} from "./aiAskStepSummary.ts";
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
  const [expanded, setExpanded] = useState(status === "running");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
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
  const overallLabel = status === "running" ? "执行中"
    : status === "completed" ? `已完成 ${steps.filter((step) => step.status === "completed").length} 步`
      : status === "cancelled" ? "已取消"
        : backendTerminated ? "执行失败" : "进度中断";
  const displayedSteps = steps.map((step): AiAskRawStep => ({
    ...step,
    status: terminal && step.status === "running"
      ? status === "completed" ? "completed" : "failed"
      : step.status,
  }));
  const collapsedSummary = formatCompletedSummary(groupSteps(displayedSteps), citationCount);
  const completedAndCollapsed = status === "completed" && !expanded;

  const copyDiagnostics = async (): Promise<void> => {
    setCopyFeedback("");
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(formatSafeAiAskDiagnostics(events, status, query));
      setCopyFeedback(AI_ASK_EXECUTION_COPY.copied);
    } catch {
      setCopyFeedback(AI_ASK_EXECUTION_COPY.copyFailed);
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
        aria-label="AI 问答执行过程"
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
              <span className="sp-ai-execution-details-link">{AI_ASK_EXECUTION_COPY.details}</span>
            </>
          ) : (
            <>
              <span>问答执行过程</span>
              <span className="sp-ai-execution-overall">{overallLabel}</span>
            </>
          )}
        </summary>
        {status === "failed" && !backendTerminated ? (
          <p className="sp-ai-execution-note" role="status">
            未收到后端结束事件：本次失败可能来自前端事件契约或传输中断，不能据此判断后端检索失败。
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
              <summary>{detailsExpanded ? AI_ASK_EXECUTION_COPY.hideFullSteps : AI_ASK_EXECUTION_COPY.fullSteps}</summary>
              <StepDetail steps={displayedSteps} />
            </details>
          </>
        ) : <p className="sp-ai-execution-waiting" role="status">{AI_ASK_EXECUTION_COPY.noSteps}</p>}
        {loading ? (
          <Button variant="tertiary" type="button" className="sp-ai-execution-cancel" onClick={onCancel}>
            取消问答
          </Button>
        ) : null}
      </details>
      <div className="sp-ai-execution-actions">
        <Button variant="tertiary" type="button" onClick={() => void copyDiagnostics()}>
          {AI_ASK_EXECUTION_COPY.copyDebug}
        </Button>
        {copyFeedback ? <span className="sp-ai-execution-copy-feedback" role="status">{copyFeedback}</span> : null}
      </div>
    </div>
  );
}
