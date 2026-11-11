import type { AiAskRawStep, AiAskStageSummary } from "./aiAskStepSummary.ts";
import { AI_ASK_EXECUTION_COPY, groupSteps } from "./aiAskStepSummary.ts";

const TECHNICAL_TERMS = /hybrid|exact|bm25|vector|rrf|http|候选资产\s*id/i;

function safeConcept(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !TECHNICAL_TERMS.test(normalized) ? normalized : null;
}

function description(stage: AiAskStageSummary): string {
  if (stage.id === "understanding") {
    const concept = stage.concepts.map(safeConcept).find((item) => item !== null);
    return concept ? AI_ASK_EXECUTION_COPY.summary.identifyConcept(concept) : "";
  }
  if (stage.id === "retrieval") {
    return stage.candidateCount === null
      ? AI_ASK_EXECUTION_COPY.summary.multiRouteRetrieval
      : AI_ASK_EXECUTION_COPY.summary.foundCandidates(stage.candidateCount);
  }
  if (stage.id === "verification") {
    const parts: string[] = [];
    if (stage.verifiedTableCount !== null) parts.push(AI_ASK_EXECUTION_COPY.summary.verifiedTables(stage.verifiedTableCount));
    if (stage.verifiedFieldCount !== null) parts.push(AI_ASK_EXECUTION_COPY.summary.verifiedFields(stage.verifiedFieldCount));
    return parts.join(" · ");
  }
  return stage.status === "completed" ? AI_ASK_EXECUTION_COPY.summary.answerGenerated : "";
}

function marker(stage: AiAskStageSummary): string {
  if (stage.status === "completed") return "✓";
  if (stage.status === "failed") return "!";
  if (stage.status === "running") return "";
  return "○";
}

export function StepSummary({ steps }: { steps: readonly AiAskRawStep[] }) {
  const stages = groupSteps(steps);
  return (
    <ol className="sp-ai-stage-list" aria-label="问答阶段摘要">
      {stages.map((stage, index) => {
        const detail = description(stage);
        return (
          <li className={`sp-ai-stage sp-ai-stage-${stage.status}`} key={stage.id}>
            <span className="sp-ai-stage-marker" aria-hidden="true">
              {marker(stage)}
            </span>
            <span className="sp-ai-stage-content">
              <span className="sp-ai-stage-heading">
                <strong>{index + 1} {stage.label}</strong>
                <span className="sp-ai-stage-status">{AI_ASK_EXECUTION_COPY.statuses[stage.status]}</span>
              </span>
              {detail ? <span className="sp-ai-stage-description">{detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
