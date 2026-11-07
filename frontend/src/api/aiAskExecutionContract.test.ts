import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AiAskExecutionContractError,
  parseAiAskExecutionEvent,
  type AiAskExecutionEvent,
} from "./aiAskExecution.ts";
import {
  httpRequestCountLabel,
  receivedTerminalEvent,
  searchRequestNote,
} from "./aiAskExecutionSummary.ts";
import { requestRemoteEventStream } from "./http.ts";

/**
 * 真实后端事件样本。由 backend/tests/test_ai_ask_sse_contract.py 通过
 * AIAskExecutionService + RagSearchService 实际运行生成，不是手写 fixture。
 */
const fixturePath = fileURLToPath(
  new URL("../../../backend/tests/fixtures/ai_ask_stream_contract.json", import.meta.url),
);

interface ContractFrame {
  event: string;
  data: string;
}

interface ContractScenario {
  name: string;
  query: string;
  responseStatus: string;
  doneReasonCode: string | null;
  events: ContractFrame[];
}

interface ContractSample {
  scenarios: ContractScenario[];
}

let cached: ContractSample | null = null;

async function sample(): Promise<ContractSample> {
  if (cached === null) {
    cached = JSON.parse(await readFile(fixturePath, "utf8")) as ContractSample;
  }
  return cached;
}

async function scenario(name: string): Promise<ContractScenario> {
  const found = (await sample()).scenarios.find((item) => item.name === name);
  assert.ok(found, `契约样本缺少场景 ${name}`);
  return found;
}

/** 把真实事件帧重新拼成 text/event-stream 报文，并按固定大小切片。 */
function toSseChunks(frames: readonly ContractFrame[], chunkSize = 97): string[] {
  const body = frames.map((frame) => `event: ${frame.event}\ndata: ${frame.data}\n\n`).join("");
  const chunks: string[] = [];
  for (let index = 0; index < body.length; index += chunkSize) {
    chunks.push(body.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * 走真实传输层 + 真实事件解析器重放整段后端事件序列。
 *
 * `askAiWithExecution` 的运行模式门禁依赖 `import.meta.env`，在 node 测试环境中
 * 无法开启 remote，因此这里复用同一套 `requestRemoteEventStream` 与
 * `parseAiAskExecutionEvent`，覆盖真实 SSE 帧格式与分片读取。
 */
async function replay(frames: readonly ContractFrame[]): Promise<AiAskExecutionEvent[]> {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunks = toSseChunks(frames);
  globalThis.fetch = (() => Promise.resolve(new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  ))) as typeof fetch;

  const events: AiAskExecutionEvent[] = [];
  try {
    await requestRemoteEventStream(
      "/ai/ask/stream",
      { method: "POST", body: { query: "契约回归", scope: "all", topK: 10 } },
      (rawEvent) => {
        events.push(parseAiAskExecutionEvent(rawEvent));
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  return events;
}

function stepIds(events: readonly AiAskExecutionEvent[]): string[] {
  return events
    .filter((event) => event.event !== "answer" && event.event !== "done")
    .map((event) => event.stepId);
}

test("真实后端 insufficient_evidence 序列整段解析成功且不被当作失败", async () => {
  const { events: frames, responseStatus, doneReasonCode } = await scenario("insufficient_evidence");
  const events = await replay(frames);

  assert.equal(events.length, frames.length, "每一帧都必须被解析，不能在中途抛出");
  assert.ok(receivedTerminalEvent(events), "必须收到后端 done 终态事件");

  const done = events.find((event) => event.event === "done");
  assert.ok(done, "缺少 done 事件");
  assert.equal(done.data?.["status"], "completed", "证据不足是正常终态");
  assert.equal(done.data?.["reasonCode"] ?? null, doneReasonCode ?? null);
  assert.equal(done.data?.["reasonCode"], "insufficient_evidence");

  const answer = events.find((event) => event.event === "answer");
  assert.ok(answer, "缺少 answer 事件");
  const response = answer.data?.["response"] as { status: string };
  assert.equal(response.status, responseStatus);
  assert.equal(response.status, "insufficient_evidence");
});

test("真实后端多查询 RAG 序列覆盖 catalog/search/merge/verification/answer/done", async () => {
  const { events: frames, doneReasonCode } = await scenario("multi_query_rag");
  const events = await replay(frames);

  assert.equal(events.length, frames.length, "每一帧都必须被解析，不能在中途抛出");
  assert.ok(receivedTerminalEvent(events));

  const ids = stepIds(events);
  for (const prefix of ["planning", "rag-round-1", "search-", "catalog-", "merge", "verification", "asset-", "field-", "generating"]) {
    assert.ok(ids.some((id) => id.startsWith(prefix)), `缺少 ${prefix}* 步骤`);
  }

  const searchStarts = events.filter((event) => event.event === "step_start" && event.stepId.startsWith("search-"));
  assert.equal(searchStarts.length, 3, "多查询 RAG 必须按 3 个候选查询各发一次检索");
  assert.deepEqual(
    searchStarts.map((event) => event.data?.["requestCount"]),
    [1, 1, 1],
    "每个真实检索步骤都必须上报 requestCount=1",
  );

  const done = events.find((event) => event.event === "done");
  assert.ok(done);
  assert.equal(done.data?.["status"], "completed");
  assert.equal(done.data?.["reasonCode"] ?? null, doneReasonCode ?? null);
});

test("真实 catalog 事件的目录核验字段全部被接受", async () => {
  const { events: frames } = await scenario("multi_query_rag");
  const events = await replay(frames);

  const catalogStarts = events.filter(
    (event) => event.event === "step_start" && event.stepId.startsWith("catalog-"),
  );
  assert.ok(catalogStarts.length >= 1);
  for (const event of catalogStarts) {
    const data = event.data || {};
    assert.equal(data["phase"], "database");
    assert.equal(typeof data["candidateAssetCount"], "number");
    assert.equal(typeof data["candidateFieldCount"], "number");
    assert.equal(typeof data["databaseCallCount"], "number");
  }

  const catalogCompletes = events.filter(
    (event) => event.event === "step_complete" && event.stepId.startsWith("catalog-"),
  );
  assert.ok(catalogCompletes.length >= 1);
  for (const event of catalogCompletes) {
    assert.equal(typeof (event.data || {})["verifiedAssetCount"], "number");
    assert.equal(typeof (event.data || {})["verifiedFieldCount"], "number");
  }
});

test("真实 search 完成事件的 stageTimings 被结构化校验后保留", async () => {
  const { events: frames } = await scenario("multi_query_rag");
  const events = await replay(frames);

  const completes = events.filter(
    (event) => event.event === "step_complete" && event.stepId.startsWith("search-"),
  );
  assert.ok(completes.length >= 1);
  for (const event of completes) {
    const timings = (event.data || {})["stageTimings"] as Record<string, unknown>;
    assert.ok(timings && typeof timings === "object");
    assert.deepEqual(Object.keys(timings).sort(), ["catalogValidationMs", "httpSearchMs"]);
    for (const value of Object.values(timings)) {
      assert.equal(typeof value, "number");
      assert.ok(Number.isFinite(value) && Number(value) >= 0);
    }
  }
});

test("真实样本仍然拒绝未知字段、非法 stageTimings 与非法 phase", async () => {
  const { events: frames } = await scenario("multi_query_rag");
  const catalogFrame = frames.find((frame) => {
    if (frame.event !== "step_start") return false;
    const payload = JSON.parse(frame.data) as { step_id?: string };
    return (payload.step_id || "").startsWith("catalog-");
  });
  assert.ok(catalogFrame, "样本缺少 catalog step_start 帧");

  const searchComplete = frames.find((frame) => {
    if (frame.event !== "step_complete") return false;
    const payload = JSON.parse(frame.data) as { step_id?: string };
    return (payload.step_id || "").startsWith("search-");
  });
  assert.ok(searchComplete, "样本缺少 search step_complete 帧");

  const mutate = (frame: ContractFrame, mutateData: (data: Record<string, unknown>) => void): ContractFrame => {
    const payload = JSON.parse(frame.data) as { data?: Record<string, unknown> };
    const data = { ...(payload.data || {}) };
    mutateData(data);
    return { event: frame.event, data: JSON.stringify({ ...payload, data }) };
  };

  // 未知字段仍然必须被拒绝：不允许用关闭严格校验的方式"修复"契约漂移。
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(catalogFrame, (data) => { data["unexpectedField"] = 1; })),
    (error: unknown) => error instanceof AiAskExecutionContractError && /不支持的数据/.test(error.message),
  );
  // 阶段标识是封闭枚举。
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(catalogFrame, (data) => { data["phase"] = "quantum"; })),
    /不支持的阶段标识/,
  );
  // 计数类字段必须是非负整数。
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(catalogFrame, (data) => { data["candidateAssetCount"] = -1; })),
    /不支持的数据/,
  );
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(catalogFrame, (data) => { data["databaseCallCount"] = 1.5; })),
    /不支持的数据/,
  );
  // stageTimings 只接受已知阶段键与非负有限数值。
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(searchComplete, (data) => {
      data["stageTimings"] = { httpSearchMs: -1, catalogValidationMs: 1 };
    })),
    /阶段耗时事件格式无效/,
  );
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(searchComplete, (data) => {
      data["stageTimings"] = { httpSearchMs: 1, catalogValidationMs: 1, unknownStageMs: 1 };
    })),
    /阶段耗时事件格式无效/,
  );
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(searchComplete, (data) => {
      data["stageTimings"] = "not-an-object";
    })),
    /阶段耗时事件格式无效/,
  );
  // done 事件仍然只允许 status/stepCount/reasonCode。
  const doneFrame = frames.find((frame) => frame.event === "done");
  assert.ok(doneFrame);
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(doneFrame, (data) => { data["token"] = "must-not-stream"; })),
    (error: unknown) => error instanceof AiAskExecutionContractError && /不支持的数据/.test(error.message),
  );
  assert.throws(
    () => parseAiAskExecutionEvent(mutate(doneFrame, (data) => { data["reasonCode"] = "Not A Code"; })),
    /结束事件包含不支持的数据/,
  );
});

test("请求次数展示口径：未知不等于 0", async () => {
  const { events: frames } = await scenario("multi_query_rag");
  const events = await replay(frames);

  const merge = events.find((event) => event.stepId === "merge" && event.event === "step_complete");
  assert.ok(merge, "样本缺少 merge 完成事件");
  const mergeData = merge.data || {};
  assert.equal(mergeData["requestCount"], 3);
  assert.equal(httpRequestCountLabel(mergeData), "实际 HTTP 检索请求 3 次");

  // 缺少 requestCount 时不得冒充 0 次请求。
  assert.equal(httpRequestCountLabel({}), "实际 HTTP 检索请求次数未上报");
  assert.equal(searchRequestNote({}), "该步骤未上报请求次数；不能据此判断后端是否发起检索。");
  assert.equal(searchRequestNote({ requestCount: 0 }), "未向 RAG HTTP Search API 发出请求。");
  assert.equal(searchRequestNote({ requestCount: 2 }), null);
});
