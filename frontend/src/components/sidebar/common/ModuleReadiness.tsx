import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  MODULE_READINESS_SPECS,
  readinessPercentage,
  type ModuleReadinessResult,
  type ReadinessModuleId,
} from "./moduleReadiness.ts";

export function ModuleReadiness({ result, title }: { result: ModuleReadinessResult; title?: string }) {
  const { t, i18n } = useTranslation("common");
  const id = useId();
  if (result.status === "not_applicable") {
    return null;
  }
  const percentage = readinessPercentage(result);
  const status = result.status === "ready" && percentage === null ? "unavailable" : result.status;
  const updated = result.updatedAt ? new Date(result.updatedAt) : null;
  const percentageLabel = percentage === null ? null : new Intl.NumberFormat(i18n.language, {
    style: "percent", maximumFractionDigits: 2,
  }).format(percentage / 100);
  const spec = MODULE_READINESS_SPECS[result.moduleId as ReadinessModuleId];
  const rawDefinition = result.definition?.trim() || "";
  const usesCanonicalDefinition = Boolean(
    result.metricId && (!rawDefinition || rawDefinition === spec?.definition),
  );
  const localizedDefinition = usesCanonicalDefinition && result.metricId
    ? t(`readiness.metrics.${result.metricId}.definition`, { defaultValue: rawDefinition })
    : rawDefinition;

  return (
    <section className="module-readiness" data-module={result.moduleId} aria-labelledby={id}>
      <h3 id={id}>{title ?? t("readiness.title")}</h3>
      <p role="status">
        {percentageLabel ?? t(`readiness.status.${status}`)}
        {percentage !== null && <small> · {result.numerator} / {result.denominator}</small>}
      </p>
      {percentage !== null || status === "loading" ? (
        <progress className="sidebar-progress-track" aria-labelledby={id} aria-describedby={`${id}-description`} max={100} value={percentage ?? undefined} />
      ) : (
        <div className="sidebar-progress-track sidebar-progress-track--empty" aria-hidden="true" />
      )}
      <small id={`${id}-description`}>{localizedDefinition || t(`readiness.description.${status}`)}</small>
      {updated && Number.isFinite(updated.getTime()) && (
        <small>{t("readiness.updated")} <time dateTime={updated.toISOString()}>{updated.toLocaleString(i18n.language)}</time></small>
      )}
    </section>
  );
}
