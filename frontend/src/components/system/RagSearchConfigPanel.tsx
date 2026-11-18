import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  DEFAULT_RAG_SEARCH_CONFIG,
  getRagSearchConfig,
  getRagSearchDiagnostics,
  supportsRagSearchConfig,
  updateRagSearchConfig,
  type RagSearchConfig,
  type RagSearchDiagnostics,
} from "../../api/ragSearchConfig.ts";
import { Button, Select } from "../../ui/index.ts";

export function RagSearchConfigPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation("common");
  const [config, setConfig] = useState<RagSearchConfig>({ ...DEFAULT_RAG_SEARCH_CONFIG });
  const [diagnostics, setDiagnostics] = useState<RagSearchDiagnostics>({
    status: "disabled",
    reasonCode: "disabled",
    health: "unknown",
    ready: false,
    tokenConfigured: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supported = supportsRagSearchConfig();

  const statusLabel = (status: RagSearchDiagnostics["status"]): string =>
    t(`aiManagement.rag.status.${status}`);
  const statusDescription = (status: RagSearchDiagnostics): string => {
    if (status.status === "disabled") return t("aiManagement.rag.statusDescription.disabled");
    if (status.status === "ready") return t("aiManagement.rag.statusDescription.ready");
    return t("aiManagement.rag.statusDescription.unavailable", { reason: status.reasonCode || t("aiManagement.rag.unknownReason") });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getRagSearchConfig(), getRagSearchDiagnostics()])
      .then(([nextConfig, nextDiagnostics]) => {
        if (!active) return;
        setConfig(nextConfig);
        setDiagnostics(nextDiagnostics);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : t("aiManagement.rag.readFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const update = <K extends keyof RagSearchConfig>(key: K, value: RagSearchConfig[K]): void => {
    setConfig((current) => ({ ...current, [key]: value }));
    setNotice("");
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateRagSearchConfig(config);
      setConfig(saved);
      setNotice(t("aiManagement.rag.saved"));
      setDiagnostics(await getRagSearchDiagnostics());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("aiManagement.rag.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    setError("");
    try {
      setDiagnostics(await getRagSearchDiagnostics());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("aiManagement.rag.checkFailed"));
    } finally {
      setChecking(false);
    }
  };

  return (
    <details className="rag-config-panel" open>
      <summary>
        <span className="rag-config-title">{t("aiManagement.rag.title")}</span>
        <span className={`rag-config-state rag-config-state-${diagnostics.status}`}>
          {statusLabel(diagnostics.status)}
        </span>
      </summary>
      <div className="rag-config-body">
        <p className="rag-config-intro">{t("aiManagement.rag.description")}</p>
        {!supported ? (
          <div className="rag-config-message" role="status">{t("aiManagement.rag.mockNotice")}</div>
        ) : null}
        {loading ? <div className="rag-config-message" role="status">{t("aiManagement.rag.reading")}</div> : null}
        {error ? <div className="rag-config-error" role="alert">{error}</div> : null}
        {notice ? <div className="rag-config-message" role="status">{notice}</div> : null}

        <div className="rag-config-form">
          <label className="rag-config-field rag-config-field-wide">
            <span>{t("aiManagement.rag.retrievalMode")}</span>
            <Select<string>
              aria-label={t("aiManagement.rag.retrievalMode")}
              className="inp"
              items={[
                { label: t("aiManagement.rag.retrievalModes.local"), value: "local" },
                { label: t("aiManagement.rag.retrievalModes.external"), value: "external" },
              ]}
              value={config.retrievalMode}
              disabled={!canEdit || !supported || loading || saving}
              onValueChange={(value) => {
                if (value === "local" || value === "external") update("retrievalMode", value);
              }}
            />
            <small>{t("aiManagement.rag.retrievalModeDescription")}</small>
          </label>

          <label className="rag-config-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("enabled", event.target.checked)}
            />
            <span>{t("aiManagement.rag.enabled")}</span>
          </label>
          <div className="rag-config-field rag-config-field-wide" role="note">
            <span>{t("aiManagement.rag.enabledDescription")}</span>
            <small>{t("aiManagement.rag.enabledValues")}</small>
          </div>

          <div className="rag-config-field" role="note">
            <span>{t("aiManagement.rag.strategy")}</span>
            <strong>{t(`aiManagement.rag.strategyValues.${config.strategy}`)}</strong>
            <small>{t("aiManagement.rag.strategyDescription")}</small>
            <small>{t("aiManagement.rag.strategyValuesDescription")}</small>
          </div>

          <label className="rag-config-field">
            <span>{t("aiManagement.rag.topK")}</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={config.topK}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("topK", Number(event.target.value))}
            />
            <small>{t("aiManagement.rag.topKDescription")}</small>
            <small>{t("aiManagement.rag.topKRange")}</small>
          </label>

          <label className="rag-config-field">
            <span>{t("aiManagement.rag.timeoutMs")}</span>
            <input
              type="number"
              min={250}
              max={10000}
              step={1}
              value={config.timeoutMs}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("timeoutMs", Number(event.target.value))}
            />
            <small>{t("aiManagement.rag.timeoutDescription")}</small>
            <small>{t("aiManagement.rag.timeoutRange")}</small>
          </label>

          <label className="rag-config-field rag-config-field-wide">
            <span>{t("aiManagement.rag.serviceUrl")}</span>
            <input
              type="url"
              value={config.serviceUrl}
              placeholder={t("aiManagement.rag.serviceUrlPlaceholder")}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("serviceUrl", event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <small>{t("aiManagement.rag.serviceUrlDescription")}</small>
          </label>

          <div className="rag-config-field rag-config-field-wide" role="status">
            <span>{t("aiManagement.rag.tokenConfigured")}</span>
            <strong>{config.tokenConfigured ? t("aiManagement.rag.configured") : t("aiManagement.rag.notConfigured")}</strong>
            <small>{t("aiManagement.rag.tokenDescription")}</small>
          </div>
        </div>

        <div className="rag-config-diagnostic" role="status">
          <strong>{statusLabel(diagnostics.status)}</strong>
          <span>{statusDescription(diagnostics)}</span>
          <span>{t("aiManagement.rag.tokenStatus", { status: diagnostics.tokenConfigured ? t("aiManagement.rag.configured") : t("aiManagement.rag.notConfigured") })}</span>
        </div>

        <div className="rag-config-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={!supported || loading || checking}
            onClick={() => void check()}
          >
            {checking ? t("aiManagement.rag.checking") : t("aiManagement.rag.check")}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!canEdit || !supported || loading || saving}
            onClick={() => void save()}
          >
            {saving ? t("aiManagement.rag.saving") : t("aiManagement.rag.save")}
          </Button>
        </div>
        <p className="rag-config-footnote">{t("aiManagement.rag.footnote")}</p>
      </div>
    </details>
  );
}
