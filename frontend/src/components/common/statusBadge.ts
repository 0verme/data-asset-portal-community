import { normalizeBinaryStatusLabel, normalizeBinaryStatusValue } from "./status.ts";

export type StatusBadgeTone = "neutral" | "success" | "warning" | "danger";

export interface StatusMeta {
  label?: string | undefined;
  className?: string | undefined;
  [key: string]: unknown;
}

export interface ResolveStatusBadgeOptions {
  status?: unknown;
  metaMap?: Record<string, StatusMeta> | undefined;
  on?: unknown;
  label?: string | undefined;
}

export interface StatusBadgePresentation {
  label: string;
  tone: StatusBadgeTone;
}

const DEFAULT_STATUS_META: Record<string, StatusMeta> = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

function semanticTone(...values: unknown[]): Exclude<StatusBadgeTone, "neutral"> | undefined {
  const labels = values.filter((value): value is string => typeof value === "string");
  if (labels.some((value) => /(^|[\s_-])(error|failed|failure|danger|invalid|rejected|exception|fatal)([\s_-]|$)|失败|错误|异常|严重/i.test(value))) {
    return "danger";
  }
  if (labels.some((value) => /(^|[\s_-])(warning|warn|pending|attention)([\s_-]|$)|待处理|待审核|警告|告警|预警/i.test(value))) {
    return "warning";
  }
  if (labels.some((value) => /(^|[\s_-])(success|succeeded|ok)([\s_-]|$)|成功/i.test(value))) {
    return "success";
  }
  return undefined;
}

function resolveTone(
  value: unknown,
  label: string,
  meta: StatusMeta | undefined,
): StatusBadgeTone {
  const className = meta?.className;
  if (className === "st-on" || className === "tag-ok") return "success";
  if (className === "st-warn" || className === "tag-warn") return "warning";
  if (className === "tag-danger") return "danger";
  if (className === "tag-neutral") return "neutral";

  const semantic = semanticTone(value, label);
  if (className === "st-off") return semantic ?? "neutral";
  if (semantic) return semantic;

  return normalizeBinaryStatusValue(value) === "enabled" ? "success" : "neutral";
}

export function resolveStatusBadgePresentation({
  status,
  metaMap,
  on,
  label,
}: ResolveStatusBadgeOptions): StatusBadgePresentation {
  const hasStatus = status !== undefined;
  const value = hasStatus ? status : on;
  const normalized = normalizeBinaryStatusValue(value);
  const statusKey = normalized ?? (typeof value === "string" ? value : undefined);
  const statusMap = hasStatus ? (metaMap ?? DEFAULT_STATUS_META) : DEFAULT_STATUS_META;
  const meta = statusKey ? statusMap[statusKey] : undefined;

  const fallbackLabel = hasStatus
    ? label || (typeof status === "string" && status.trim() ? status : "未知")
    : label || (typeof on === "string" && on.trim() ? on : "未知");
  const displayLabel = !hasStatus && label
    ? label
    : meta?.label || (normalized ? normalizeBinaryStatusLabel(value) : fallbackLabel);

  return {
    label: displayLabel,
    tone: resolveTone(value, displayLabel, meta),
  };
}
