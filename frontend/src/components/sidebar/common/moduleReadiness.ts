// The producer owns the definition and the canonical percentage for both DAP and the website.
export interface ModuleReadinessResult {
  moduleId: string;
  metricId: string | null;
  status: "ready" | "loading" | "unavailable" | "pending_definition" | "pending_integration" | "not_applicable";
  definition: string | null;
  numerator: number | null;
  denominator: number | null;
  percentage: number | null;
  updatedAt: string | null;
}

export function readinessPercentage(result: ModuleReadinessResult): number | null {
  const { metricId, definition, numerator, denominator, percentage } = result;
  if (result.status !== "ready" || !metricId?.trim() || !definition?.trim()) return null;
  if (numerator === null || !Number.isSafeInteger(numerator) || numerator < 0) return null;
  if (denominator === null || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator > denominator) return null;
  if (percentage === null || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
  return percentage;
}
