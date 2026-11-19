import type { AiAskExecutionEvent, AiAskExecutionStatus } from "../../api/aiAskExecution.ts";
import type { DataOrbStatus } from "./orb/DataOrb.tsx";

type DataOrbSignals = {
  aiActive: boolean;
  aiLoading: boolean;
  aiExecutionStatus: AiAskExecutionStatus | null;
  aiExecutionEvents: readonly AiAskExecutionEvent[];
  typing: boolean;
  focused: boolean;
};

const retrievalStep = /^(?:retrieving|verification|metadata-count|rag-round-[12]|(?:search|catalog)-[a-f0-9]+|asset-(?:(?:report|indicator|api)-)?\d+|field-\d+-\d+)$/;

export function resolveDataOrbStatus({
  aiActive, aiLoading, aiExecutionStatus, aiExecutionEvents, typing, focused,
}: DataOrbSignals): DataOrbStatus {
  if (aiActive) {
    if (aiExecutionStatus === "cancelled" || aiExecutionStatus === "failed") return aiExecutionStatus;

    // The page supplies only the current run's events, even before the stream promise settles.
    const done = aiExecutionEvents.find((event) => event.event === "done")?.data?.["status"];
    if (done === "cancelled" || done === "failed") return done;
    if (done === "completed" || aiExecutionStatus === "completed") return "completed";

    if (aiLoading || aiExecutionStatus === "running") {
      // A parent retrieval step can remain open while a parallel child step ends.
      const activeSteps = new Set<string>();
      for (const { event, stepId } of aiExecutionEvents) {
        if (event === "step_start") activeSteps.add(stepId);
        if (event === "step_complete" || event === "step_error") activeSteps.delete(stepId);
      }
      if (activeSteps.has("generating")) return "generating";
      if ([...activeSteps].some((step) => retrievalStep.test(step))) return "retrieving";
      return "processing";
    }
  }

  if (typing) return "typing";
  return focused ? "focused" : "idle";
}
