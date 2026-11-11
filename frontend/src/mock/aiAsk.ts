/**
 * Public static-demo AI adapter. This module must only be loaded by the
 * VITE_API_MODE=mock branch. It neither calls a model nor queries a RAG service.
 * The directory identities come from the existing mock asset API.
 */
import { getAssetTables, type AssetTableField, type AssetTableItem } from "../api/assets.ts";
import { parseAiAskResponse, type AiAskCandidate, type AiAskResponse, type AiAskProgressStep } from "../api/aiAsk.ts";
import type { AiAskExecutionEvent, AiAskExecutionResult } from "../api/aiAskExecution.ts";

interface DemoConcept {
  triggers: readonly string[];
  matches: readonly string[];
}

/** Demo-only vocabulary. Never import these rules from a remote service path. */
const DEMO_CONCEPTS: readonly DemoConcept[] = [
  { triggers: ["订单", "下单"], matches: ["订单", "order"] },
  { triggers: ["金额", "收入"], matches: ["金额", "amount"] },
  { triggers: ["销售额", "销售金额", "销售"], matches: ["销售", "sales", "金额"] },
  { triggers: ["交易"], matches: ["交易", "trade"] },
  { triggers: ["会员", "客户"], matches: ["会员", "member"] },
  { triggers: ["库存", "存货"], matches: ["库存", "inventory", "stock"] },
  { triggers: ["商品", "sku"], matches: ["商品", "sku", "product"] },
  { triggers: ["门店", "商店"], matches: ["门店", "store"] },
  { triggers: ["营销", "活动"], matches: ["营销", "活动", "marketing"] },
  { triggers: ["履约", "配送", "物流"], matches: ["履约", "配送", "物流", "fulfillment"] },
  { triggers: ["售后", "退款", "退货"], matches: ["售后", "退款", "退货", "service"] },
  { triggers: ["价格", "售价"], matches: ["价格", "price"] },
];

const MAX_DEMO_CANDIDATES = 5;
const DEMO_NOTICE = "【模拟演示】本结果按演示目录的名称和字段匹配，不代表真实 AI/RAG 推理结论。";

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("问答已取消。", "AbortError");
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function evidenceFor(query: string, table: AssetTableItem): { score: number; reasons: string[]; field: AssetTableField | null } {
  const input = query.toLowerCase();
  const tableText = [table.name, table.cn, table.domain, table.desc].join(" ").toLowerCase();
  const fullText = [tableText, ...table.fields.map((field) => [field.name, field.cn].join(" "))].join(" ").toLowerCase();
  const concepts = DEMO_CONCEPTS.filter((concept) => includesAny(input, concept.triggers));
  const reasons = concepts
    .filter((concept) => includesAny(fullText, concept.matches))
    .map((concept) => concept.triggers.find((trigger) => input.includes(trigger)) || concept.triggers[0] || "");
  const exactTable = input.includes(table.name.toLowerCase()) || input.includes(table.cn.toLowerCase());
  const exactFields = table.fields.filter((field) =>
    (field.cn.length >= 2 && input.includes(field.cn.toLowerCase())) ||
    (field.name.length >= 3 && input.includes(field.name.toLowerCase())),
  );
  // Compound requests must match every recognized concept, not just generic "金额".
  if (concepts.length > 1 && reasons.length < concepts.length && !exactTable && !exactFields.length) {
    return { score: 0, reasons: [], field: null };
  }
  if (!reasons.length && !exactTable && !exactFields.length) return { score: 0, reasons: [], field: null };

  const fieldRank = table.fields.map((field) => {
    const fieldText = [field.name, field.cn].join(" ").toLowerCase();
    const matchingConcepts = concepts.filter((concept) => includesAny(fieldText, concept.matches)).length;
    const direct = input.includes(field.name.toLowerCase()) || input.includes(field.cn.toLowerCase());
    return { field, score: matchingConcepts * 2 + (direct ? 6 : 0) };
  }).sort((a, b) => b.score - a.score);
  return {
    score: reasons.length * 4 + (exactTable ? 12 : 0) + (exactFields.length ? 6 : 0) + (input.includes(table.domain.toLowerCase()) ? 3 : 0),
    reasons: exactTable ? ["表名"] : exactFields.length ? ["字段名", ...reasons] : reasons,
    field: fieldRank[0] && fieldRank[0].score > 0 ? fieldRank[0].field : null,
  };
}

function toCandidate(table: AssetTableItem, query: string, reasons: string[], field: AssetTableField | null): AiAskCandidate {
  if (!Number.isSafeInteger(table.assetId) || Number(table.assetId) <= 0) {
    throw new Error("演示资产缺少可用的目录 ID。");
  }
  const wantsField = /字段|金额|价格|数量|amount|price|stock/i.test(query);
  const chosen = wantsField && field && Number.isSafeInteger(field.fieldId) && Number(field.fieldId) > 0 ? field : null;
  return {
    assetId: Number(table.assetId),
    ...(chosen ? { fieldId: Number(chosen.fieldId) } : {}),
    assetType: chosen ? "field" : "table",
    tableName: table.name,
    tableDisplayName: table.cn,
    tableDescription: table.desc,
    ...(chosen ? {
      fieldName: chosen.name,
      fieldDisplayName: chosen.cn,
      fieldDescription: chosen.cn,
    } : {}),
    domain: table.domain,
    layer: table.layer,
    source: "dap_catalog",
    matchReason: "演示目录匹配：" + [...new Set(reasons)].join("、"),
    relevance: "direct",
  };
}

export async function createMockAiAnswer(query: string, topK = 10, signal?: AbortSignal): Promise<AiAskResponse> {
  abortIfRequested(signal);
  const tables = await getAssetTables();
  abortIfRequested(signal);
  const input = query.trim();
  const isCount = /多少|几张|几条|总共有多少|总数/.test(input);
  const isUnsupported = /指标|血缘路径|上下游链路/.test(input);
  const ranked = isCount || isUnsupported ? [] : tables
    .map((table) => ({ table, ...evidenceFor(input, table) }))
    .filter((hit) => hit.score > 0 && Number.isSafeInteger(hit.table.assetId) && Number(hit.table.assetId) > 0)
    .sort((a, b) => b.score - a.score || Number(a.table.assetId) - Number(b.table.assetId));
  const bounded = ranked.slice(0, Math.min(MAX_DEMO_CANDIDATES, Math.max(1, topK)));
  const candidates = bounded.map((hit) => toCandidate(hit.table, input, hit.reasons, hit.field));
  const isList = /有哪些|哪些|所有|列表|相关的表|相关表/.test(input);
  const partial = candidates.length > 0 && (isList || ranked.length > candidates.length);
  const status = candidates.length === 0 ? "insufficient_evidence" : partial ? "partial_answer" : "answered";
  const answer = isCount
    ? DEMO_NOTICE + "当前演示未提供完整目录统计，请通过资产列表筛选查看；不会编造表数量。"
    : isUnsupported
      ? DEMO_NOTICE + "当前 Mock 仅演示数据表和字段定位。指标请使用普通搜索，血缘请进入资产详情查看。"
      : candidates.length === 0
        ? DEMO_NOTICE + "未在演示目录中找到可验证的相关表或字段。建议换用具体的主题域、表名或字段关键词。"
        : DEMO_NOTICE + "检索到以下相关演示资产：" +
          candidates.map((item) => "\n- " + item.tableDisplayName + "（" + item.tableName + "）" +
            (item.fieldName ? " · " + item.fieldDisplayName + "（" + item.fieldName + "）" : "")).join("") +
          (partial ? "\n本次结果是有界示例，不能视为全部资产。" : "");
  return parseAiAskResponse({
    status,
    answer,
    candidates,
    citations: candidates.map((item) => ({
      assetId: item.assetId,
      ...(item.fieldId ? { fieldId: item.fieldId } : {}),
      source: "dap_catalog",
    })),
    metadataCount: null,
    retrievalStatus: "available",
    generationStatus: candidates.length ? "completed" : "not_run",
    resultsTruncated: partial,
    reasonCode: candidates.length ? null : isCount ? "mock_count_unsupported" : "mock_no_evidence",
    elapsedMs: 0,
  });
}

async function pause(signal?: AbortSignal): Promise<void> {
  abortIfRequested(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 110);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("问答已取消。", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function askMockAiWithExecution(
  query: string,
  onEvent: (event: AiAskExecutionEvent) => void,
  _scope = "all",
  topK = 10,
  signal?: AbortSignal,
): Promise<AiAskExecutionResult> {
  abortIfRequested(signal);
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const emit = (event: AiAskExecutionEvent["event"], stepId: string, message: string, data?: Record<string, unknown>): void => {
    abortIfRequested(signal);
    onEvent({ event, requestId, stepId, timestamp: new Date().toISOString(), message, ...(data ? { data } : {}) });
  };
  let answer: AiAskResponse | null = null;
  for (const [stepId, message] of [
    ["analyzing", "识别演示目录检索意图"],
    ["retrieving", "检索本地演示表和字段"],
    ["organizing", "整理已匹配的演示资产"],
  ] as const) {
    emit("step_start", stepId, message);
    await pause(signal);
    if (stepId === "retrieving") answer = await createMockAiAnswer(query, topK, signal);
    emit("step_complete", stepId, message, stepId === "retrieving" && answer
      ? { tableCount: new Set(answer.candidates.map((item) => item.assetId)).size,
          fieldCount: answer.candidates.filter((item) => item.fieldId).length }
      : undefined);
  }
  abortIfRequested(signal);
  if (!answer) answer = await createMockAiAnswer(query, topK, signal);
  answer = parseAiAskResponse({ ...answer, elapsedMs: Date.now() - started });
  emit("answer", "answer", "演示答案已就绪", { response: answer });
  emit("done", "done", "演示问答完成", { status: "completed", stepCount: 3 });
  return { response: answer, status: "completed" };
}

export async function askMockAiWithProgress(
  query: string,
  onProgress: (step: AiAskProgressStep) => void,
  topK = 10,
  signal?: AbortSignal,
): Promise<AiAskResponse> {
  const result = await askMockAiWithExecution(query, (event) => {
    if (event.event === "step_start" || event.event === "step_complete") {
      onProgress({
        id: event.stepId as AiAskProgressStep["id"],
        status: event.event === "step_start" ? "running" : "completed",
        elapsedMs: 0,
      });
    }
  }, "all", topK, signal);
  return result.response;
}
