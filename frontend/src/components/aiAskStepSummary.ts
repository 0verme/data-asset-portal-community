export type AiAskStageId = "understanding" | "retrieval" | "verification" | "answer";
export type AiAskStageStatus = "pending" | "running" | "completed" | "failed";
export type AiAskRawStepStatus = "running" | "completed" | "failed";

export interface AiAskRawStep {
  id: string;
  status: AiAskRawStepStatus;
  message?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

export interface AiAskStageSummary {
  id: AiAskStageId;
  label: string;
  status: AiAskStageStatus;
  concepts: string[];
  candidateCount: number | null;
  verifiedTableCount: number | null;
  verifiedFieldCount: number | null;
}

/** User-facing copy is centralized here; detailed diagnostics retain server text. */
export const AI_ASK_EXECUTION_COPY = {
  stages: {
    understanding: "理解问题",
    retrieval: "检索资产",
    verification: "核实明细",
    answer: "生成回答",
  },
  statuses: {
    pending: "等待中",
    running: "进行中",
    completed: "已完成",
    failed: "未完成",
  },
  summary: {
    identifyConcept: (concept: string) => `识别概念「${concept}」`,
    multiRouteRetrieval: "多路检索",
    foundCandidates: (count: number) => `多路检索，找到 ${count} 个候选`,
    verifiedTables: (count: number) => `已核实 ${count} 张表`,
    verifiedFields: (count: number) => `${count} 个字段`,
    answerGenerated: "回答已生成",
  },
  details: "查看详细过程",
  fullSteps: "查看完整执行步骤",
  copyDebug: "复制排查信息",
  copied: "已复制排查信息",
  copyFailed: "复制失败，请检查浏览器剪贴板权限",
  noSteps: "正在连接问答服务并等待真实执行事件。",
} as const;

const STAGE_IDS: readonly AiAskStageId[] = [
  "understanding",
  "retrieval",
  "verification",
  "answer",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readCount(data: Record<string, unknown>, key: string): number | null {
  return nonNegativeInteger(data[key]);
}

function readConcepts(steps: readonly AiAskRawStep[]): string[] {
  const concepts = new Set<string>();
  for (const step of steps) {
    if (step.id !== "planning" && step.id !== "analyzing") continue;
    const values = step.data?.["keyConcepts"];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === "string" && value.trim()) concepts.add(value.trim());
    }
  }
  return [...concepts];
}

function stageForStep(id: string): AiAskStageId | null {
  if (id === "planning" || id === "analyzing") return "understanding";
  if (id === "merge" || id === "retrieving" || /^rag-round-\d+$/.test(id) || id.startsWith("search-")) {
    return "retrieval";
  }
  if (
    id === "verification"
    || id.startsWith("catalog-")
    || /^asset-\d+$/.test(id)
    || /^field-\d+-\d+$/.test(id)
  ) {
    return "verification";
  }
  if (id === "generating") return "answer";
  // Special count/error events and future event types stay in the detail list.
  return null;
}

function statusForStage(
  id: AiAskStageId,
  steps: readonly AiAskRawStep[],
  allSteps: readonly AiAskRawStep[],
): AiAskStageStatus {
  if (!steps.length) return "pending";
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "running")) return "running";

  if (
    id === "retrieval"
    && steps.some((step) => step.id.startsWith("search-") || step.id.startsWith("rag-round-"))
    && !steps.some((step) => step.id === "merge")
  ) {
    // Search-round events can finish before the cross-query merge is emitted.
    return "running";
  }
  if (
    id === "verification"
    && allSteps.some((step) => step.id === "merge" && step.status === "running")
  ) {
    // Candidate details may still grow until the retrieval merge finishes.
    return "running";
  }
  if (
    id === "verification"
    && steps.every((step) => step.id.startsWith("catalog-"))
    && !allSteps.some((step) => step.id === "merge" && step.status === "completed")
  ) {
    // Catalog candidate checks run inside retrieval, before authoritative details.
    return "running";
  }
  return "completed";
}

function verifiedCounts(steps: readonly AiAskRawStep[]): {
  tableCount: number | null;
  fieldCount: number | null;
} {
  const verification = [...steps].reverse().find((step) => step.id === "verification");
  const summaryData = verification?.data;
  const summarizedTableCount = summaryData ? readCount(summaryData, "verifiedTableCount") : null;
  const summarizedFieldCount = summaryData ? readCount(summaryData, "verifiedFieldCount") : null;

  const verifiedAssetIds = new Set(
    steps
      .filter((step) => step.id.startsWith("asset-")
        && step.status === "completed"
        && step.data?.["source"] === "dap_authoritative_metadata")
      .map((step) => step.id),
  );
  const verifiedFieldIds = new Set(
    steps
      .filter((step) => step.id.startsWith("field-")
        && step.status === "completed"
        && step.data?.["source"] === "dap_authoritative_metadata")
      .map((step) => step.id),
  );

  return {
    tableCount: summarizedTableCount ?? (verifiedAssetIds.size ? verifiedAssetIds.size : null),
    fieldCount: summarizedFieldCount ?? (verifiedFieldIds.size ? verifiedFieldIds.size : null),
  };
}

function candidateCount(steps: readonly AiAskRawStep[]): number | null {
  const merge = [...steps].reverse().find((step) => step.id === "merge");
  const data = merge?.data;
  if (!data) return null;
  const count = readCount(data, "deduplicatedCount");
  if (count !== null) return count;
  const ids = data["selectedAssetIds"];
  return Array.isArray(ids) && ids.every((id) => nonNegativeInteger(id) !== null)
    ? ids.length
    : null;
}

/**
 * Purely groups the current execution-step snapshot into the four business
 * stages. It reads counts only from structured event data; unknown/special
 * steps are intentionally ignored here and remain available to StepDetail.
 */
export function groupSteps(rawSteps: readonly unknown[] | null | undefined): AiAskStageSummary[] {
  const validSteps: AiAskRawStep[] = [];
  if (Array.isArray(rawSteps)) {
    for (const value of rawSteps) {
      if (!isRecord(value)) continue;
      const id = value["id"];
      const status = value["status"];
      if (
        typeof id !== "string"
        || (status !== "running" && status !== "completed" && status !== "failed")
      ) continue;
      validSteps.push({
        id,
        status,
        ...(typeof value["message"] === "string" ? { message: value["message"] } : {}),
        ...(isRecord(value["data"]) ? { data: value["data"] } : {}),
        ...(typeof value["timestamp"] === "string" ? { timestamp: value["timestamp"] } : {}),
      });
    }
  }

  const grouped = new Map<AiAskStageId, AiAskRawStep[]>(STAGE_IDS.map((id) => [id, []]));
  for (const step of validSteps) {
    const stage = stageForStep(step.id);
    if (stage) grouped.get(stage)?.push(step);
  }
  const verified = verifiedCounts(validSteps);
  return STAGE_IDS.map((id) => {
    const stageSteps = grouped.get(id) || [];
    return {
      id,
      label: AI_ASK_EXECUTION_COPY.stages[id],
      status: statusForStage(id, stageSteps, validSteps),
      concepts: id === "understanding" ? readConcepts(stageSteps) : [],
      candidateCount: id === "retrieval" ? candidateCount(stageSteps) : null,
      verifiedTableCount: id === "verification" ? verified.tableCount : null,
      verifiedFieldCount: id === "verification" ? verified.fieldCount : null,
    };
  });
}
