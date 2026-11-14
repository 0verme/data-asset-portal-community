import { useEffect, useState } from "react";
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

const DIAGNOSTIC_LABELS: Record<RagSearchDiagnostics["status"], string> = {
  disabled: "外部服务未启用",
  ready: "外部服务就绪",
  unavailable: "外部服务暂不可用",
};

function statusDescription(status: RagSearchDiagnostics): string {
  if (status.status === "disabled") {
    return "外部 RAG 服务未启用；普通关键词搜索和 AI 本地检索不受影响。";
  }
  if (status.status === "ready") {
    return "DAP 已通过 HTTP 完成外部服务存活与就绪检查；返回的资产仍会按当前目录重新验证。";
  }
  return `外部 RAG HTTP 服务暂不可用（${status.reasonCode || "未知原因"}）；普通关键词搜索和 AI 本地检索不受影响，外部模式不会回退到本地。`;
}

export function RagSearchConfigPanel({ canEdit }: { canEdit: boolean }) {
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
        setError(reason instanceof Error ? reason.message : "读取 RAG 配置失败。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
      setNotice("AI 问答检索与 RAG 推荐配置已保存。普通关键词搜索保持不变。");
      const nextDiagnostics = await getRagSearchDiagnostics();
      setDiagnostics(nextDiagnostics);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存 RAG 配置失败。");
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
      setError(reason instanceof Error ? reason.message : "索引诊断失败。");
    } finally {
      setChecking(false);
    }
  };

  return (
    <details className="rag-config-panel">
      <summary>
        <span className="rag-config-title">AI 问答检索与 RAG 推荐配置</span>
        <span className={`rag-config-state rag-config-state-${diagnostics.status}`}>
          {DIAGNOSTIC_LABELS[diagnostics.status]}
        </span>
      </summary>
      <div className="rag-config-body">
        <p className="rag-config-intro">
          AI 问答可使用 DAP 内置目录检索或外部 RAG Search Service；不论检索模式，回答和引用都必须通过当前 DAP 元数据验证。搜索页的相关资产推荐默认关闭，启用外部服务后才可使用；它不影响普通关键词搜索。DAP 不加载索引、不调用 RAG CLI 或代替 AI 问答配置 LLM。
        </p>
        {!supported ? (
          <div className="rag-config-message" role="status">
            模拟模式仅展示关闭状态；持久化配置与索引诊断需连接后端。
          </div>
        ) : null}
        {loading ? <div className="rag-config-message" role="status">正在读取配置…</div> : null}
        {error ? <div className="rag-config-error" role="alert">{error}</div> : null}
        {notice ? <div className="rag-config-message" role="status">{notice}</div> : null}

        <div className="rag-config-form">
          <label className="rag-config-field rag-config-field-wide">
            <span>AI 问答检索模式</span>
            <Select<string>
              aria-label="AI 问答检索模式"
              className="inp"
              items={[
                { label: "内置本地检索（DAP 目录）", value: "local" },
                { label: "外部 RAG Search Service", value: "external" },
              ]}
              value={config.retrievalMode}
              disabled={!canEdit || !supported || loading || saving}
              onValueChange={(value) => {
                if (value === "local" || value === "external") update("retrievalMode", value);
              }}
            />
            <small>
              本地模式直接使用 DAP 当前目录检索，不需要外部服务 URL 或 Token。外部模式只使用下方已启用且配置完成的 RAG Search Service；调用失败不会回退到本地。此项仅控制 AI 问答检索，普通关键词搜索及可选的搜索页推荐由下方开关分别控制。本地模式会隐藏已存的外部 URL；若没有已有 URL，切到外部模式并启用前请填写服务地址。
            </small>
          </label>
          <label className="rag-config-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("enabled", event.target.checked)}
            />
            <span>启用外部 RAG Search Service</span>
          </label>
          <div className="rag-config-field rag-config-field-wide" role="note">
            <small>
              外部模式需要启用此服务并配置 URL/Token；该服务也用于搜索页的可选相关资产推荐。本地 AI 检索不依赖此开关。
            </small>
          </div>
          <div className="rag-config-field" role="note">
            <span>检索策略</span>
            <strong>由 RAG 服务端配置决定</strong>
            <small>
              HTTP Search Service v1 仅接受 query 和 topK，不接受请求级策略。实际策略由 RAG 服务端的 DAP_RAG_SEARCH_MODE 配置；DAP 已保存的 strategy 字段仅为兼容保留，不会影响检索。
            </small>
          </div>
          <label className="rag-config-field">
            <span>最多推荐条数</span>
            <input
              type="number"
              min={1}
              max={20}
              value={config.topK}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("topK", Number(event.target.value))}
            />
          </label>
          <label className="rag-config-field">
            <span>请求超时（毫秒）</span>
            <input
              type="number"
              min={250}
              max={10000}
              step={250}
              value={config.timeoutMs}
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("timeoutMs", Number(event.target.value))}
            />
          </label>
          <label className="rag-config-field rag-config-field-wide">
            <span>RAG Service URL</span>
            <input
              type="url"
              value={config.serviceUrl}
              placeholder="同机可用 http://127.0.0.1:<port>；跨机必须使用 https://<RAG_SERVICE_HOST>"
              disabled={!canEdit || !supported || loading || saving}
              onChange={(event) => update("serviceUrl", event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="rag-config-field rag-config-field-wide" role="status">
            <span>服务端认证 Token</span>
            <strong>{config.tokenConfigured ? "已在后端 Secret 中配置" : "未配置"}</strong>
            <small>通过部署 Secret 设置 RAG_SEARCH_SERVICE_TOKEN；Token 不写入参数表、不经浏览器传输或返回。</small>
          </div>
        </div>

        <div className="rag-config-diagnostic" role="status">
          <strong>{DIAGNOSTIC_LABELS[diagnostics.status]}</strong>
          <span>{statusDescription(diagnostics)}</span>
          <span>Token：{diagnostics.tokenConfigured ? "已配置" : "未配置"}</span>
        </div>

        <div className="rag-config-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={!supported || loading || checking}
            onClick={() => void check()}
          >
            {checking ? "正在检查…" : "检查 RAG Service"}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!canEdit || !supported || loading || saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存配置"}
          </Button>
        </div>
        <p className="rag-config-footnote">
          只有受保护的管理配置页加载或管理员手动检查时才请求 /healthz 与 /readyz；普通搜索不请求诊断。推荐请求有超时限制；远端服务错误、令牌缺失或目录校验失败时 fail closed，不影响确定性关键词搜索。DAP 按 HTTP Search Service v1 请求与解析；算法模式在 RAG 服务端配置。
        </p>
      </div>
    </details>
  );
}
