import type { AiAskExecutionEvent } from "./aiAskExecution.ts";

/**
 * 「实际 HTTP 检索请求次数」的展示口径。
 *
 * 后端只在真正发出检索请求的步骤上上报 `requestCount`。前端不得把「未上报」
 * 当成 0，否则一次前端事件解析中断就会被误读成「后端没有发起检索」。
 */
export interface RequestCountEvidence {
  /** 后端是否为该步骤上报了真实请求次数。 */
  reported: boolean;
  /** 已上报时为非负整数；未上报时为 null。 */
  count: number | null;
}

export function requestCountEvidence(
  data: Record<string, unknown> | undefined,
): RequestCountEvidence {
  const value = data?.["requestCount"];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { reported: true, count: value };
  }
  return { reported: false, count: null };
}

/** 合并/轮次类步骤的请求次数文案：未上报时明确说明未知，不显示 0。 */
export function httpRequestCountLabel(data: Record<string, unknown> | undefined): string {
  const { reported, count } = requestCountEvidence(data);
  if (!reported || count === null) return "实际 HTTP 检索请求次数未上报";
  return `实际 HTTP 检索请求 ${count} 次`;
}

/** 单个检索步骤的附加说明；返回 null 表示无需额外说明。 */
export function searchRequestNote(data: Record<string, unknown> | undefined): string | null {
  const { reported, count } = requestCountEvidence(data);
  if (!reported) return "该步骤未上报请求次数；不能据此判断后端是否发起检索。";
  if (count === 0) return "未向 RAG HTTP Search API 发出请求。";
  return null;
}

/**
 * 后端是否发出了终态 `done` 事件。
 *
 * 没有 `done` 就说明这次失败可能来自前端事件契约或传输中断，
 * 不能直接断言后端检索失败。
 */
export function receivedTerminalEvent(events: readonly AiAskExecutionEvent[]): boolean {
  return events.some((event) => event.event === "done");
}
