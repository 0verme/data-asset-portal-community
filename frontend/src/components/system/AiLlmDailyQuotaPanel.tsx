import { useEffect, useState } from "react";
import {
  DEFAULT_AI_LLM_DAILY_QUOTA,
  getAiLlmDailyQuota,
  supportsAiLlmDailyQuota,
  updateAiLlmDailyQuota,
  type AiLlmDailyQuota,
} from "../../api/aiLlmDailyQuota.ts";
import { Button } from "../../ui/index.ts";

const MAX_DAILY_LIMIT = 2_147_483_647;

export function AiLlmDailyQuotaPanel({ canEdit }: { canEdit: boolean }) {
  const [quota, setQuota] = useState<AiLlmDailyQuota>({ ...DEFAULT_AI_LLM_DAILY_QUOTA });
  const [dailyLimit, setDailyLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supported = supportsAiLlmDailyQuota();

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAiLlmDailyQuota()
      .then((current) => {
        if (!active) return;
        setQuota(current);
        setDailyLimit(current.dailyLimit);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "读取每日 AI 问答额度失败。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const save = async (): Promise<void> => {
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) {
      setError("每日上限必须为 1 到 2,147,483,647 之间的整数。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateAiLlmDailyQuota(dailyLimit);
      setQuota(saved);
      setDailyLimit(saved.dailyLimit);
      setNotice("全站每日 AI 问答上限已保存，并写入操作审计。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存每日 AI 问答上限失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="rag-config-panel llm-quota-panel">
      <summary>
        <span className="rag-config-title">全站每日 AI 问答额度</span>
        <span className="rag-config-state rag-config-state-ready">
          {loading ? "正在读取" : supported ? `今日剩余 ${quota.remaining} 次` : "模拟模式"}
        </span>
      </summary>
      <div className="rag-config-body">
        <p className="rag-config-intro">
          统计至少发起一次真实 LLM Provider HTTP 请求的 AI 问答；每次问答最多计一次，与内部规划、答案生成及重试的模型 HTTP 调用次数无关。全站用户与应用实例共享，按北京时间（Asia/Shanghai）自然日重置，不按用户或 IP 限额。
        </p>
        {!supported ? (
          <div className="rag-config-message" role="status">
            模拟模式仅展示默认值，不读取或修改后端真实额度；切换到远端 API 模式后可管理持久化配置。
          </div>
        ) : null}
        {loading ? <div className="rag-config-message" role="status">正在读取额度与使用量…</div> : null}
        {error ? <div className="rag-config-error" role="alert">{error}</div> : null}
        {notice ? <div className="rag-config-message" role="status">{notice}</div> : null}

        <div className="rag-config-form">
          <label className="rag-config-field">
            <span>每日 AI 问答上限</span>
            <input
              type="number"
              min={1}
              max={MAX_DAILY_LIMIT}
              step={1}
              value={dailyLimit}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
            />
          </label>
          <div className="rag-config-field" role="status">
            <span>今日已使用 / 剩余（问答次数）</span>
            <strong>{quota.used} / {quota.remaining}</strong>
            <small>{quota.businessDate ? `${quota.businessDate}（${quota.timezone}）` : "每日按 Asia/Shanghai 自然日重置"}</small>
          </div>
        </div>

        <div className="rag-config-diagnostic" role="status">
          <strong>全站共享</strong>
          <span>已发起模型 HTTP 请求的成功、失败或取消问答均计一次；未发起模型请求的问答不扣减。达到上限后拒绝新的 LLM 调用。</span>
        </div>
        <div className="rag-config-actions">
          <Button
            variant="primary"
            type="button"
            disabled={!canEdit || !supported || loading || saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存每日上限"}
          </Button>
        </div>
        <p className="rag-config-footnote">
          配置仍使用 AI_LLM_DAILY_LIMIT 参数编码并保存在现有系统参数表中，计数保存在共享业务数据库中；更新操作受 system:param:write 权限保护并写入操作审计。纯目录 COUNT、Mock 问答、普通搜索及 RAG 推荐不消耗该额度。
        </p>
      </div>
    </details>
  );
}
