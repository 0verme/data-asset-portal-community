import { isValidTime } from "../components/common/time.js";

export function getSystemBadgeText(value) {
  if (value == null) return "";

  const normalizedValue = String(value).trim();
  if (!normalizedValue) return "";

  const firstSegment = normalizedValue.split(/[_-]+/)[0]?.trim();
  return firstSegment || normalizedValue;
}

export function comparePushSystemImportance(left, right) {
  const leftRank = left?.importanceLevel === "important" ? 0 : 1;
  const rightRank = right?.importanceLevel === "important" ? 0 : 1;
  return leftRank - rightRank;
}

export function isValidLatestOutputTime(importanceLevel, value) {
  const normalizedValue = String(value || "").trim();
  return importanceLevel !== "important" || !normalizedValue || isValidTime(normalizedValue);
}

export function normalizeLatestOutputTime(importanceLevel, value) {
  return importanceLevel === "important" ? String(value || "").trim() : "";
}
