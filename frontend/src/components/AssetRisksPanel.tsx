// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "../utils/date.ts";
import { Icon } from "./ui.tsx";

interface SeverityMeta {
    labelKey: "risk.severity.error" | "risk.severity.warning" | "risk.severity.info";
    tagClass: string;
}

const SEVERITY_META: Record<string, SeverityMeta> = {
    error: { labelKey: "risk.severity.error", tagClass: "tag-danger" },
    warning: { labelKey: "risk.severity.warning", tagClass: "tag-warn" },
    info: { labelKey: "risk.severity.info", tagClass: "tag-info" },
};
const DEFAULT_SEVERITY: SeverityMeta = { labelKey: "risk.severity.warning", tagClass: "tag-warn" };

const SOURCE_META: Record<string, "risk.sources.portal" | "risk.sources.codeAudit" | "risk.sources.manual" | "risk.sources.import" | "risk.sources.external"> = {
    portal: "risk.sources.portal",
    code_audit: "risk.sources.codeAudit",
    manual: "risk.sources.manual",
    import: "risk.sources.import",
    external: "risk.sources.external",
};

interface AssetRisk {
    severity?: string | undefined;
    risk_source?: string | undefined;
    asset_name?: string | undefined;
    asset_key?: string | undefined;
    action_url?: string | undefined;
    created_at?: unknown;
    rule_code?: string | undefined;
    rule_name?: string | undefined;
    message?: string | undefined;
    suggestion?: unknown;
    risk_id?: string | number | undefined;
}

function isAssetRisk(value: unknown): value is AssetRisk {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getText(value: unknown, fallback = "-"): string {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function getSafeActionUrl(value: unknown): string {
    const actionUrl = String(value || "").trim();
    if (!actionUrl) return "";
    if (actionUrl.startsWith("/") && !actionUrl.startsWith("//"))
        return actionUrl;

    try {
        const url = new URL(actionUrl);
        return url.protocol === "http:" || url.protocol === "https:"
            ? actionUrl
            : "";
    } catch {
        return "";
    }
}

interface RiskMetaProps {
    label: string;
    value: ReactNode;
    mono?: boolean | undefined;
}

function RiskMeta({ label, value, mono = false }: RiskMetaProps) {
    return (
        <div className="asset-risk-meta-item">
            <span>{label}</span>
            <b className={mono ? "mono" : undefined}>{value}</b>
        </div>
    );
}

function AssetRiskCard({ risk }: { risk: AssetRisk }) {
    const { t } = useTranslation("warehouse");
    const severity =
        SEVERITY_META[risk.severity || ""] || DEFAULT_SEVERITY;
    const sourceKey = SOURCE_META[risk.risk_source || ""];
    const source = sourceKey ? t(sourceKey) : getText(risk.risk_source);
    const assetName = getText(risk.asset_name || risk.asset_key);
    const actionUrl = getSafeActionUrl(risk.action_url);

    return (
        <div className="asset-risk-card">
            <div className="asset-risk-card-head">
                <div className="asset-risk-tags">
                    <span className={`tag ${severity.tagClass}`}>
                        {t(severity.labelKey)}
                    </span>
                    <span className="tag tag-neutral">{source}</span>
                </div>
                {risk.created_at ? (
                    <span className="asset-risk-time">
                        {formatDateTime(risk.created_at)}
                    </span>
                ) : null}
            </div>

            <div className="asset-risk-title">
                <span className="asset-risk-rule mono">
                    {getText(risk.rule_code)}
                </span>
                <span>{getText(risk.rule_name, t("risk.unnamedRule"))}</span>
            </div>

            <div className="asset-risk-meta">
                <RiskMeta label={t("risk.asset")} value={assetName} mono />
                <RiskMeta label={t("risk.source")} value={source} />
            </div>

            <div className="asset-risk-text">
                {getText(risk.message, t("risk.noDescription"))}
            </div>
            {risk.suggestion ? (
                <div className="asset-risk-suggestion">
                    {getText(risk.suggestion)}
                </div>
            ) : null}

            {actionUrl ? (
                <div className="asset-risk-actions">
                    <a className="btn" href={actionUrl}>
                        <Icon name="edit" size={14} />
                        {t("risk.resolve")}
                    </a>
                </div>
            ) : null}
        </div>
    );
}

export interface AssetRisksPanelProps {
    assetRisks?: readonly unknown[] | null | undefined;
}

export function AssetRisksPanel({ assetRisks }: AssetRisksPanelProps) {
    const { t } = useTranslation("warehouse");
    const risks = Array.isArray(assetRisks)
        ? assetRisks.filter(isAssetRisk)
        : [];

    return (
        <section
            className="asset-risks-panel"
            aria-labelledby="asset-risks-title"
        >
            <div className="asset-risks-head">
                <h3 id="asset-risks-title">
                    <Icon name="inbox" size={15} />
                    {t("risk.title")}
                </h3>
                <span className="asset-risks-count mono">{risks.length}</span>
            </div>

            {risks.length ? (
                <div className="asset-risk-list">
                    {risks.map((risk, index) => (
                        <AssetRiskCard
                            key={
                                risk.risk_id ||
                                `${risk.rule_code || "risk"}-${index}`
                            }
                            risk={risk}
                        />
                    ))}
                </div>
            ) : (
                <div className="asset-risks-empty">{t("risk.empty")}</div>
            )}
        </section>
    );
}
