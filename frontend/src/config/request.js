const DEFAULT_REQUEST_TIMEOUT = 60000;
const DEFAULT_LONG_REQUEST_TIMEOUT = 120000;

function parseTimeout(value, fallback) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

export const REQUEST_TIMEOUT = parseTimeout(
  import.meta.env.VITE_API_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
);

export const LONG_REQUEST_TIMEOUT = Math.max(REQUEST_TIMEOUT, DEFAULT_LONG_REQUEST_TIMEOUT);

export function resolveRequestTimeout(value, fallback = REQUEST_TIMEOUT) {
  return parseTimeout(value, fallback);
}

export function formatTimeoutLabel(timeoutMs) {
  if (timeoutMs % 1000 === 0) {
    return `${timeoutMs / 1000}秒`;
  }
  return `${timeoutMs}ms`;
}

export function summarizeRequestPayload(value) {
  if (value == null) return "";

  try {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}...` : text;
  } catch (_error) {
    return "[unserializable payload]";
  }
}
