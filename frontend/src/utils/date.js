const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{2}:\d{2}:\d{2})(?:[.,]\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;
const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/;

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDate(date, includeTime) {
  const dateText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return includeTime ? `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : dateText;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

/** Formats a date-time without changing the timezone semantics of timestamp strings. */
export function formatDateTime(value) {
  if (isBlank(value)) return "-";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "-" : formatLocalDate(value, true);

  const match = String(value).trim().match(DATE_TIME_PATTERN);
  return match ? `${match[1]} ${match[2]}` : "-";
}

/** Formats a calendar date for display. */
export function formatDate(value) {
  if (isBlank(value)) return "-";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "-" : formatLocalDate(value, false);

  const match = String(value).trim().match(DATE_PATTERN);
  return match ? match[1] : "-";
}
