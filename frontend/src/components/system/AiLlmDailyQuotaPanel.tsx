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
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 60_000;
const MIN_MAX_TOKENS = 64;
const MAX_MAX_TOKENS = 4096;

export function AiLlmDailyQuotaPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation("common");
  const [quota, setQuota] = useState<AiLlmDailyQuota>({ ...DEFAULT_AI_LLM_DAILY_QUOTA });
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.dailyLimit);
  const [enabled, setEnabled] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.enabled);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.baseUrl);
  const [model, setModel] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.model);
  const [timeoutMs, setTimeoutMs] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.timeoutMs);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.maxTokens);
  const [disableThinking, setDisableThinking] = useState(DEFAULT_AI_LLM_DAILY_QUOTA.disableThinking);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supported = supportsAiLlmDailyQuota();
  const usageAvailable = supported && loaded && !error;
  const configAvailable = loaded || !supported;

  const applyLoaded = (current: AiLlmDailyQuota): void => {
    setQuota(current);
    setDailyLimit(current.dailyLimit);
    setEnabled(current.enabled);
    setBaseUrl(current.baseUrl);
    setModel(current.model);
    setTimeoutMs(current.timeoutMs);
    setMaxTokens(current.maxTokens);
    setDisableThinking(current.disableThinking);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    getAiLlmDailyQuota()
      .then((current) => {
        if (!active) return;
        applyLoaded(current);
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
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      setError(t("aiManagement.quota.invalidTimeout"));
      return;
    }
    if (!Number.isSafeInteger(maxTokens) || maxTokens < MIN_MAX_TOKENS || maxTokens > MAX_MAX_TOKENS) {
      setError(t("aiManagement.quota.invalidMaxTokens"));
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateAiLlmDailyQuota({
        dailyLimit,
        enabled,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        timeoutMs,
        maxTokens,
        disableThinking,
      });
      applyLoaded(saved);
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
          <label className="rag-config-toggle">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setNotice("");
              }}
            />
            <span>{t("aiManagement.quota.enabled")}</span>
          </label>
          <div className="rag-config-field rag-config-field-wide" role="note">
            <span>{t("aiManagement.quota.enabledDescription")}</span>
            <small>{t("aiManagement.quota.enabledRequirement")}</small>
          </div>

          <label className="rag-config-field rag-config-field-wide">
            <span>{t("aiManagement.quota.baseUrl")}</span>
            <input
              type="url"
              value={configAvailable ? baseUrl : ""}
              placeholder={t("aiManagement.quota.baseUrlPlaceholder")}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setNotice("");
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <small>{t("aiManagement.quota.baseUrlDescription")}</small>
          </label>

          <label className="rag-config-field">
            <span>{t("aiManagement.quota.model")}</span>
            <input
              type="text"
              value={configAvailable ? model : ""}
              placeholder={t("aiManagement.quota.modelPlaceholder")}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setModel(event.target.value);
                setNotice("");
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <small>{t("aiManagement.quota.modelDescription")}</small>
          </label>

          <label className="rag-config-field">
            <span>{t("aiManagement.quota.dailyLimit")}</span>
            <input
              type="number"
              min={1}
              max={MAX_DAILY_LIMIT}
              step={1}
              value={configAvailable ? dailyLimit : ""}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setDailyLimit(Number(event.target.value));
                setNotice("");
              }}
            />
            <small>{t("aiManagement.quota.limitRange")}</small>
          </label>

          <label className="rag-config-field">
            <span>{t("aiManagement.quota.timeoutMs")}</span>
            <input
              type="number"
              min={MIN_TIMEOUT_MS}
              max={MAX_TIMEOUT_MS}
              step={1}
              value={configAvailable ? timeoutMs : ""}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setTimeoutMs(Number(event.target.value));
                setNotice("");
              }}
            />
            <small>{t("aiManagement.quota.timeoutRange")}</small>
          </label>

          <label className="rag-config-field">
            <span>{t("aiManagement.quota.maxTokens")}</span>
            <input
              type="number"
              min={MIN_MAX_TOKENS}
              max={MAX_MAX_TOKENS}
              step={1}
              value={configAvailable ? maxTokens : ""}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setMaxTokens(Number(event.target.value));
                setNotice("");
              }}
            />
            <small>{t("aiManagement.quota.maxTokensRange")}</small>
          </label>

          <label className="rag-config-toggle">
            <input
              type="checkbox"
              checked={disableThinking}
              disabled={!canEdit || !supported || !loaded || loading || saving}
              onChange={(event) => {
                setDisableThinking(event.target.checked);
                setNotice("");
              }}
            />
            <span>{t("aiManagement.quota.disableThinking")}</span>
          </label>
          <div className="rag-config-field rag-config-field-wide" role="note">
            <small>{t("aiManagement.quota.disableThinkingDescription")}</small>
          </div>

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

          <div className="rag-config-field" role="status">
            <span>{t("aiManagement.quota.apiKeyConfigured")}</span>
            <strong>{quota.apiKeyConfigured ? t("aiManagement.quota.apiKeyReady") : t("aiManagement.quota.apiKeyMissing")}</strong>
            <small>{t("aiManagement.quota.apiKeyDescription")}</small>
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
