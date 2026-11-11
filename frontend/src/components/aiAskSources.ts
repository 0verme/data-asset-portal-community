import type { AiAskCandidate, AiAskCitation } from "../api/aiAsk.ts";

function citationIdentity(assetId: number, fieldId: number | null | undefined): string {
  return `${assetId}:${fieldId ?? "table"}`;
}

/**
 * The answer source list is a projection of candidates that are both returned
 * from the DAP catalog and explicitly cited by the validated answer response.
 */
export function selectVerifiedCitedCandidates(
  candidates: readonly AiAskCandidate[],
  citations: readonly AiAskCitation[],
): AiAskCandidate[] {
  const cited = new Set(
    citations
      .filter((citation) => citation.source === "dap_catalog")
      .map((citation) => citationIdentity(citation.assetId, citation.fieldId)),
  );
  return candidates.filter((candidate) =>
    candidate.source === "dap_catalog"
    && cited.has(citationIdentity(candidate.assetId, candidate.fieldId)),
  );
}
