export function lineageUnavailableState(loading: boolean, error: string | null, status?: string) {
  if (loading) return "loading";
  if (error !== null) return "error";
  if (status === "no_active_snapshot") return "noActiveSnapshot";
  if (status === "empty_snapshot") return "emptySnapshot";
  return "emptyDescription";
}
