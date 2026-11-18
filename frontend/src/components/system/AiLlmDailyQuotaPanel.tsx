import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("common");
  const [quota, setQuota] = useState<AiLlmDailyQuota>({ ...DEFAULT_AI_LLM_DAILY_QUOTA });
  const [dailyLimit, setDailyLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supported = supportsAiLlmDailyQuota();
  const usageAvailable = supported && loaded && !error;
  const configAvailable = loaded || !supported;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    getAiLlmDailyQuota()
      .then((current) => {
        if (!active) return;
        setQuota(current);
        setDailyLimit(current.dailyLimit);
        setLoaded(true);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t("aiManagement.quota.readFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [t]);

  const save = async (): Promise<void> => {
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) {
      setError(t("aiManagement.quota.invalidLimit"));
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateAiLlmDailyQuota(dailyLimit);
      setQuota(saved);
      setDailyLimit(saved.dailyLimit);
      setLoaded(true);
      setNotice(t("aiManagement.quota.saved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("aiManagement.quota.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const summary = loading
    ? t("aiManagement.quota.loading")
    : usageAvailable
      ? t("aiManagement.quota.remaining", { count: quota.remaining })
      : supported && error
        ? t("aiManagement.quota.unavailable")
        : supported
          ? t("aiManagement.quota.configured", { count: quota.dailyLimit })
          : t("aiManagement.quota.mock");

  return (
    <details className="rag-config-panel llm-quota-panel" open>
      <summary>
        <span className="rag-config-title">{t("aiManagement.quota.title")}</span>
        <span className="rag-config-state rag-config-state-ready">{summary}</span>
      </summary>
      <div className="rag-config-body">
        <p className="rag-config-intro">{t("aiManagement.quota.description")}</p>
        {!supported ? (
          <div className="rag-config-message" role="status">
            {t("aiManagement.quota.mockNotice")}
          </div>
        ) : null}
        {loading ? <div className="rag-config-message" role="status">{t("aiManagement.quota.reading")}</div> : null}
        {error ? <div className="rag-config-error" role="alert">{error}</div> : null}
        {notice ? <div className="rag-config-message" role="status">{notice}</div> : null}

        <div className="rag-config-form">
          <label className="rag-config-field">
            <span>{t("aiManagement.quota.dailyLimit")}</span>
            <input
              type="number"
              min={1}
              max={MAX_DAILY_LIMIT}
              step={1}
              value={configAvailable ? dailyLimit : ""}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
            />
            <small>{t("aiManagement.quota.limitRange")}</small>
          </label>
          <div className="rag-config-field" role="status">
            <span>{t("aiManagement.quota.usage")}</span>
            {usageAvailable ? (
              <>
                <strong>{t("aiManagement.quota.usageValues", { used: quota.used, remaining: quota.remaining })}</strong>
                <small>{t("aiManagement.quota.resetDate", { date: quota.businessDate, timezone: quota.timezone })}</small>
              </>
            ) : (
              <>
                <strong>{t("aiManagement.quota.unavailable")}</strong>
                <small>{t("aiManagement.quota.noUsageStats")}</small>
              </>
            )}
          </div>
        </div>

        <div className="rag-config-diagnostic" role="status">
          <strong>{t("aiManagement.quota.sharedLabel")}</strong>
          <span>{t("aiManagement.quota.sharedDescription")}</span>
          <span>{t("aiManagement.quota.resetTime")}</span>
        </div>
        <div className="rag-config-actions">
          <Button
            variant="primary"
            type="button"
            disabled={!canEdit || !supported || !loaded || loading || saving}
            onClick={() => void save()}
          >
            {saving ? t("aiManagement.quota.saving") : t("aiManagement.quota.save")}
          </Button>
        </div>
        <p className="rag-config-footnote">{t("aiManagement.quota.footnote")}</p>
      </div>
    </details>
  );
}
