import { isValidTime } from "../components/common/time.js";

export function getSystemBadgeText(value?: unknown): string {
  if (value == null) return "";

  const normalizedValue = String(value).trim();
  if (!normalizedValue) return "";

  const firstSegment = normalizedValue.split(/[_-]+/)[0]?.trim();
  return firstSegment || normalizedValue;
}

export interface PushSystemImportanceTarget {
  importanceLevel?: string | undefined;
  [key: string]: unknown;
}

export function comparePushSystemImportance(
  left?: PushSystemImportanceTarget | null,
  right?: PushSystemImportanceTarget | null,
): number {
  const leftRank = left?.importanceLevel === "important" ? 0 : 1;
  const rightRank = right?.importanceLevel === "important" ? 0 : 1;
  return leftRank - rightRank;
}

export function isValidLatestOutputTime(
  importanceLevel?: unknown,
  value?: unknown,
): boolean {
  const normalizedValue = String(value || "").trim();
  return (
    importanceLevel !== "important" ||
    !normalizedValue ||
    isValidTime(normalizedValue)
  );
}

export function normalizeLatestOutputTime(
  importanceLevel?: unknown,
  value?: unknown,
): string {
  return importanceLevel === "important" ? String(value || "").trim() : "";
}
