import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AI_LLM_DAILY_QUOTA,
  getAiLlmDailyQuota,
  supportsAiLlmDailyQuota,
  updateAiLlmDailyQuota,
} from "./aiLlmDailyQuota.ts";

test("Mock mode exposes only the safe default and cannot persist real quota state", async () => {
  assert.equal(supportsAiLlmDailyQuota(), false);
  assert.deepEqual(await getAiLlmDailyQuota(), DEFAULT_AI_LLM_DAILY_QUOTA);
  await assert.rejects(updateAiLlmDailyQuota(99), /模拟模式不支持持久化每日 AI 问答额度/);
});
