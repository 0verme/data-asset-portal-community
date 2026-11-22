import { useId } from "react";
import { useTranslation } from "react-i18next";
import { readinessPercentage, type ModuleReadinessResult } from "./moduleReadiness.ts";
import "./module-readiness.css";

export function ModuleReadiness({ result, title }: { result: ModuleReadinessResult; title?: string }) {
  const { t, i18n } = useTranslation("common");
  const id = useId();
  const percentage = readinessPercentage(result);
  const status = result.status === "ready" && percentage === null ? "unavailable" : result.status;
  const updated = result.updatedAt ? new Date(result.updatedAt) : null;
  const percentageLabel = percentage === null ? null : new Intl.NumberFormat(i18n.language, {
    style: "percent", maximumFractionDigits: 2,
  }).format(percentage / 100);

  return (
    <section className="module-readiness" data-module={result.moduleId} aria-labelledby={id}>
      <h3 id={id}>{title ?? t("readiness.title")}</h3>
      <p role="status">
        {percentageLabel ?? t(`readiness.status.${status}`)}
        {percentage !== null && <small> · {result.numerator} / {result.denominator}</small>}
      </p>
      {percentage !== null || status === "loading" ? (
        <progress aria-labelledby={id} aria-describedby={`${id}-description`} max={100} value={percentage ?? undefined} />
      ) : (
        <div className="module-readiness__empty-track" aria-hidden="true" />
      )}
      <small id={`${id}-description`}>{result.definition?.trim() || t(`readiness.description.${status}`)}</small>
      {updated && Number.isFinite(updated.getTime()) && (
        <small>{t("readiness.updated")} <time dateTime={updated.toISOString()}>{updated.toLocaleString(i18n.language)}</time></small>
      )}
    </section>
  );
}
