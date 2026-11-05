import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/index.ts";
import type { AiAskExecutionEvent, AiAskExecutionStatus } from "../api/aiAskExecution.ts";
import "../styles/aiAskExecution.css";

interface AiAskExecutionPanelProps {
  events: AiAskExecutionEvent[];
  status: AiAskExecutionStatus | null;
  runId: number;
  loading: boolean;
  onCancel: () => void;
}

type StepStatus = "running" | "completed" | "failed";
interface ExecutionStep {
  id: string;
  status: StepStatus;
  message: string;
  data: Record<string, unknown>;
  timestamp: string;
}

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

function errorLabel(value: unknown): string {
  const labels: Record<string, string> = {
    timeout: "请求超时",
    unavailable: "服务不可用",
    invalid_response: "服务返回数据无效",
    invalid_plan: "查询规划无效，已回退到原问题",
    visibility_unavailable: "目录权限或可见性校验失败",
    asset_verification_unavailable: "无法读取权威资产明细",
    field_not_found: "字段未能按稳定 ID 核实",
    not_found: "资产不存在",
    service_auth_not_configured: "检索服务未完成服务端配置",
    service_unauthorized: "检索服务鉴权失败",
    busy: "检索服务繁忙",
    disabled: "检索服务未启用",
    llm_timeout: "模型请求超时",
    llm_busy: "模型服务繁忙",
    llm_unavailable: "模型服务不可用",
    ai_disabled: "问答服务未启用",
    ambiguous_scope: "无法唯一确认统计范围",
    metadata_count_unavailable: "DAP 目录统计暂不可用",
  };
  return typeof value === "string" ? labels[value] || "执行步骤失败" : "执行步骤失败";
}

function stepLabel(id: string, message: string): string {
  if (message) return message;
  if (id === "metadata-count") return "查询 DAP 元数据精确总数";
  if (id === "planning") return "分析问题并规划查询";
  if (id.startsWith("rag-round-")) return "检索数据资产";
  if (id === "merge") return "合并并去重检索结果";
  if (id === "verification") return "读取并核实资产明细";
  if (id === "generating") return "生成回答";
  return "执行问答步骤";
}

function StepDetails({ step }: { step: ExecutionStep }) {
  const data = step.data;
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
  const requestCount = numberValue(data["requestCount"]);
  const deduplicatedCount = numberValue(data["deduplicatedCount"]);
  const selectedIds = Array.isArray(data["selectedAssetIds"])
    ? data["selectedAssetIds"].filter((item): item is number => typeof item === "number")
    : [];

  if (step.id === "metadata-count") {
    const count = numberValue(data["tableCount"]);
    return (
      <div className="sp-ai-execution-detail">
        {count !== null ? <p>DAP 目录精确 COUNT：{count} 张表。</p> : <p>未返回可核实的统计数值；检索候选数不会替代目录 COUNT。</p>}
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"])}</p> : null}
      </div>
    );
  }
  if (step.id === "planning") {
    return (
      <div className="sp-ai-execution-detail">
        {concepts.length ? <p><strong>识别概念：</strong>{concepts.join("、")}</p> : null}
        {queries.length ? (
          <div><strong>实际候选查询：</strong><ol>{queries.map((query, index) => <li key={`${query}-${index}`}>{query}</li>)}</ol></div>
        ) : null}
        {fallback ? <p className="sp-ai-execution-note">规划不可用，已回退到原始问题检索（{errorLabel(fallback)}）。</p> : null}
        {data["planningMode"] === "exact_identifier" ? <p>标识符精确检索：仅执行原始查询。</p> : null}
      </div>
    );
  }
  if (step.id.startsWith("search-")) {
    const query = typeof data["query"] === "string" ? data["query"] : "";
    return (
      <div className="sp-ai-execution-detail">
        {query ? <p><strong>查询：</strong>{query}</p> : null}
        <p><strong>检索策略：</strong>{effectiveMode || requestedMode || "未返回策略信息"}{requestedMode && effectiveMode && requestedMode !== effectiveMode ? `（请求 ${requestedMode}）` : ""}</p>
        {channels.length ? <p><strong>实际通道：</strong>{channels.join("、")}</p> : null}
        <p><strong>结果：</strong>{retrievedCount ?? 0} 条检索结果；{verifiedCount ?? hits.length} 条通过当前目录身份校验</p>
        {requestCount === 0 ? <p className="sp-ai-execution-note">未向 RAG HTTP Search API 发出请求。</p> : null}
        {hits.length ? (
          <details className="sp-ai-execution-nested">
            <summary>查看命中资产（{hits.length}）</summary>
            <ul>
              {hits.map((hit, index) => {
                const entity = hit["entityType"] === "field" ? "字段" : "数据表";
                const name = typeof hit["name"] === "string" ? hit["name"] : "资产";
                const assetId = hit["assetId"];
                const fieldId = hit["fieldId"];
                const hitTerms = displayList(hit["matchedTerms"]);
                const hitChannels = displayList(hit["retrievalChannels"]);
                return (
                  <li key={`${String(assetId)}-${String(fieldId)}-${index}`}>
                    <span>{entity}：{name}（资产 ID {String(assetId)}{fieldId ? ` · 字段 ID ${String(fieldId)}` : ""}）</span>
                    {hitChannels.length ? <small>通道：{hitChannels.join("、")}</small> : null}
                    {hitTerms.length ? <small>命中依据：{hitTerms.slice(0, 4).join("、")}</small> : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"])}</p> : null}
      </div>
    );
  }
  if (step.id === "merge") {
    return (
      <div className="sp-ai-execution-detail">
        <p>实际 HTTP Search 请求 {requestCount ?? 0} 次 · 检索轮次 {numberValue(data["retrievalRounds"]) ?? 0}</p>
        <p>跨查询去重后保留 {deduplicatedCount ?? 0} 个候选资产身份。</p>
        {selectedIds.length ? <p>候选资产 ID：{selectedIds.join("、")}</p> : null}
        {typeof data["fusionMethod"] === "string" ? <p>排名融合：RRF（只融合各次查询内排名，不比较原始分数）。</p> : null}
      </div>
    );
  }
  if (step.id === "verification" || step.id.startsWith("asset-") || step.id.startsWith("field-")) {
    const table = typeof data["tableName"] === "string" ? data["tableName"] : null;
    const field = typeof data["fieldName"] === "string" ? data["fieldName"] : null;
    const source = data["source"] === "dap_authoritative_metadata";
    return (
      <div className="sp-ai-execution-detail">
        {table ? <p><strong>资产：</strong>{table}</p> : null}
        {field ? <p><strong>已核实字段：</strong>{field}</p> : null}
        {numberValue(data["verifiedTableCount"]) !== null ? <p>已读取 {String(data["verifiedTableCount"])} 张表，核实 {String(data["verifiedFieldCount"] ?? 0)} 个字段。</p> : null}
        {numberValue(data["fieldCount"]) !== null && step.id.startsWith("asset-") ? <p>资产详情包含 {String(data["fieldCount"])} 个字段；本次答案仅使用已关联的命中字段。</p> : null}
        {source ? <p>证据来源：DAP 权威资产明细（按稳定 ID 读取）。</p> : null}
        {data["indexEvidenceOnly"] === true ? <p className="sp-ai-execution-note">仅有索引摘要，未读取到权威资产明细；该摘要不会作为已核实证据生成答案。</p> : null}
        {typeof data["errorCode"] === "string" ? <p className="sp-ai-execution-error">{errorLabel(data["errorCode"])}</p> : null}
      </div>
    );
  }
  if (step.id.startsWith("rag-round-")) {
    return (
      <div className="sp-ai-execution-detail">
        <p>本轮 {numberValue(data["queryCount"]) ?? 0} 个查询 · 实际 HTTP 请求 {requestCount ?? 0} 次 · 返回 {retrievedCount ?? 0} 条。</p>
        {typeof data["supplementalQuery"] === "string" ? <p>补充查询：{data["supplementalQuery"]}</p> : null}
      </div>
    );
  }
  if (step.id === "generating") {
    return (
      <div className="sp-ai-execution-detail">
        <p>使用已核实 DAP 证据 {numberValue(data["evidenceCount"]) ?? 0} 条；最终答案一次性返回，不传输模型 token。</p>
      </div>
    );
  }
  return null;
}

export function AiAskExecutionPanel({ events, status, runId, loading, onCancel }: AiAskExecutionPanelProps) {
  const [expanded, setExpanded] = useState(status === "running");
  const touchedForRun = useRef(false);
  const previousRun = useRef(runId);
  const previousStatus = useRef(status);

  useEffect(() => {
    if (runId !== previousRun.current) {
      previousRun.current = runId;
      touchedForRun.current = false;
      setExpanded(true);
    }
  }, [runId]);

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous === "running" && status === "completed" && !touchedForRun.current) {
      setExpanded(false);
    }
  }, [status]);

  const steps = useMemo(() => {
    const byId = new Map<string, ExecutionStep>();
    for (const event of events) {
      if (event.event !== "step_start" && event.event !== "step_complete" && event.event !== "step_error") continue;
      const data = event.data || {};
      const prior = byId.get(event.stepId);
      const nextStatus: StepStatus = event.event === "step_error"
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
  const overallLabel = status === "running" ? "执行中"
    : status === "completed" ? `已完成 ${steps.filter((step) => step.status === "completed").length} 步`
      : status === "cancelled" ? "已取消"
        : "执行失败";
  return (
    <details
      className={`sp-ai-execution sp-ai-execution-${status || "running"}`}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      aria-label="AI 问答执行过程"
    >
      <summary
        className="sp-ai-execution-summary"
        onClick={() => {
          if (status === "running") touchedForRun.current = true;
        }}
      >
        <span>问答执行过程</span>
        <span className="sp-ai-execution-overall">{overallLabel}</span>
      </summary>
      {steps.length ? (
        <ol className="sp-ai-execution-list">
          {steps.map((step) => {
            const effectiveStatus: StepStatus = terminal && step.status === "running"
              ? status === "completed" ? "completed" : "failed"
              : step.status;
            return (
              <li className={`sp-ai-execution-step sp-ai-execution-step-${effectiveStatus}`} key={step.id}>
                <span className="sp-ai-execution-marker" aria-hidden="true" />
                <div className="sp-ai-execution-step-body">
                  <div className="sp-ai-execution-step-head">
                    <strong>{stepLabel(step.id, step.message)}</strong>
                    <span>{effectiveStatus === "running" ? "进行中" : effectiveStatus === "completed" ? "已完成" : "失败"}</span>
                  </div>
                  <StepDetails step={{ ...step, status: effectiveStatus }} />
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="sp-ai-execution-waiting" role="status">正在连接问答服务并等待真实执行事件。</p>}
      {loading ? (
        <Button variant="tertiary" type="button" className="sp-ai-execution-cancel" onClick={onCancel}>
          取消问答
        </Button>
      ) : null}
    </details>
  );
}
