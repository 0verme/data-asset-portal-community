import { useTranslation } from "react-i18next";
import type { AiAskRawStep, AiAskStageSummary } from "./aiAskStepSummary.ts";
import { groupSteps } from "./aiAskStepSummary.ts";

const TECHNICAL_TERMS = /hybrid|exact|bm25|vector|rrf|http|候选资产\s*id/i;

function safeConcept(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !TECHNICAL_TERMS.test(normalized) ? normalized : null;
}

function marker(stage: AiAskStageSummary): string {
  if (stage.status === "completed") return "✓";
  if (stage.status === "failed") return "!";
  if (stage.status === "running") return "";
  return "○";
}

export function StepSummary({ steps }: { steps: readonly AiAskRawStep[] }) {
  const { t } = useTranslation("aiAsk");
  const stages = groupSteps(steps);
  const describe = (stage: AiAskStageSummary): string => {
    if (stage.id === "understanding") {
      const concept = stage.concepts.map(safeConcept).find((item) => item !== null);
      return concept ? t("execution.summary.identifyConcept", { concept }) : "";
    }
    if (stage.id === "retrieval") {
      return stage.candidateCount === null
        ? t("execution.summary.multiRouteRetrieval")
        : t("execution.summary.foundCandidates", { count: stage.candidateCount });
    }
    if (stage.id === "verification") {
      const parts: string[] = [];
      if (stage.verifiedTableCount !== null) parts.push(t("execution.summary.verifiedTables", { count: stage.verifiedTableCount }));
      if (stage.verifiedFieldCount !== null) parts.push(t("execution.summary.verifiedFields", { count: stage.verifiedFieldCount }));
      return parts.join(" · ");
    }
    return stage.status === "completed" ? t("execution.summary.answerGenerated") : "";
  };
  return (
    <ol className="sp-ai-stage-list" aria-label={t("execution.summaryAriaLabel")}>
      {stages.map((stage, index) => {
        const detail = describe(stage);
        return (
          <li className={`sp-ai-stage sp-ai-stage-${stage.status}`} key={stage.id}>
            <span className="sp-ai-stage-marker" aria-hidden="true">
              {marker(stage)}
            </span>
            <span className="sp-ai-stage-content">
              <span className="sp-ai-stage-heading">
                <strong>{index + 1} {t(`execution.stages.${stage.id}`)}</strong>
                <span className="sp-ai-stage-status">{t(`execution.statuses.${stage.status}`)}</span>
              </span>
              {detail ? <span className="sp-ai-stage-description">{detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
