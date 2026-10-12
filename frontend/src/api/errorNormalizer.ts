export type NormalizedApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'server'
  | 'http'
  | 'network'
  | 'timeout'
  | 'unknown';

export interface NormalizedApiFieldIssue {
  /** Canonical, allow-listed field name; unknown names are intentionally omitted. */
  field: string | null;
  /** Zero-based row/index when present in a structured field path or detail. */
  index: number | null;
  /** User-facing label for known fields, or a safe generic label. */
  label: string;
}

export interface NormalizedApiError {
  kind: NormalizedApiErrorKind;
  status?: number;
  code?: string;
  /** Original message text. Presentation code should use safeMessage instead. */
  message?: string;
  /** Original details/detail value, retained for a later field presenter. */
  details?: unknown;
  /** Safe, status/category-based text that never echoes unknown server messages. */
  safeMessage: string;
  fieldIssues: NormalizedApiFieldIssue[];
}

type UnknownRecord = Record<string, unknown>;
type PathSegment = string | number;

const FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  body: 'form',
  db_type: 'dbType',
  dept_name: 'dept',
  host_name: 'host',
  status_code: 'status',
  system_id: 'id',
  unload_times: 'unloadTimes',
});

const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  abbr: '系统简称',
  code: '编码',
  db: '数据库名称',
  dbType: '数据库类型',
  dept: '业务部门',
  form: '表单内容',
  host: '主机地址',
  id: '系统标识',
  method: '请求方式',
  name: '名称',
  owner: '负责人',
  ownerDept: '归属部门',
  ownerName: '负责人',
  params: '请求参数',
  path: '请求路径',
  relations: '关联资产',
  responseFields: '响应字段',
  schema: 'Schema',
  status: '状态',
  systemId: '关联系统',
  unloadTimes: '卸数时间点',
});

const GENERIC_FIELD_LABEL = '表单内容';
const LOCATION_PREFIXES = new Set(['body', 'cookie', 'header', 'path', 'query']);

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function hasOwn(record: UnknownRecord | null, key: string): boolean {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readStatus(error: UnknownRecord | null): number | undefined {
  const status = error?.['status'];
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

function readDetails(envelope: UnknownRecord | null, payload: UnknownRecord | null): unknown {
  if (hasOwn(envelope, 'details')) return envelope?.['details'];
  if (hasOwn(payload, 'details')) return payload?.['details'];
  if (hasOwn(payload, 'detail')) return payload?.['detail'];
  return undefined;
}

function readPathSegments(value: unknown): PathSegment[] {
  if (Array.isArray(value)) {
    return value.filter((segment): segment is PathSegment =>
      typeof segment === 'string' || (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0),
    );
  }
  if (typeof value !== 'string') return [];

  return value
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment): PathSegment => {
      if (/^\d+$/.test(segment)) {
        const index = Number(segment);
        if (Number.isSafeInteger(index)) return index;
      }
      return segment;
    });
}

function normalizeFieldIssue(value: unknown): NormalizedApiFieldIssue | null {
  const detail = asRecord(value);
  if (!detail) return null;

  const rawField = detail['field'];
  const useLocation = typeof rawField !== 'string' || !rawField.trim();
  const rawPath = useLocation ? detail['loc'] : rawField;
  const segments = readPathSegments(rawPath);
  if (useLocation && typeof segments[0] === 'string' && LOCATION_PREFIXES.has(segments[0]) && segments.length > 1) {
    segments.shift();
  }

  const rawRoot = segments.find((segment): segment is string => typeof segment === 'string');
  const canonicalRoot = rawRoot ? FIELD_ALIASES[rawRoot] || rawRoot : undefined;
  const knownField = canonicalRoot && Object.prototype.hasOwnProperty.call(FIELD_LABELS, canonicalRoot)
    ? canonicalRoot
    : null;
  const explicitIndex = detail['index'];
  const pathIndex = segments.find((segment): segment is number => typeof segment === 'number');
  const index = typeof explicitIndex === 'number' && Number.isSafeInteger(explicitIndex) && explicitIndex >= 0
    ? explicitIndex
    : pathIndex ?? null;

  const hasFieldPath = segments.some((segment) => typeof segment === 'string' && Boolean(segment));
  if (!knownField && index === null && !hasFieldPath) return null;
  return {
    field: knownField,
    index,
    label: knownField ? FIELD_LABELS[knownField] || GENERIC_FIELD_LABEL : GENERIC_FIELD_LABEL,
  };
}

function normalizeFieldIssues(details: unknown): NormalizedApiFieldIssue[] {
  const entries = Array.isArray(details) ? details : [details];
  const issues: NormalizedApiFieldIssue[] = [];

  for (const entry of entries) {
    const issue = normalizeFieldIssue(entry);
    if (issue) issues.push(issue);
  }
  return issues;
}

function isTimeout(error: UnknownRecord | null, message: string | undefined): boolean {
  const name = error?.['name'];
  const code = error?.['code'];
  return name === 'TimeoutError'
    || code === 'ETIMEDOUT'
    || code === 'ECONNABORTED'
    || /(?:timeout|timed\s*out|请求超时|接口请求超时)/i.test(message || '');
}

function isNetworkError(error: unknown, record: UnknownRecord | null, message: string | undefined): boolean {
  return error instanceof TypeError
    || record?.['name'] === 'NetworkError'
    || /(?:failed to fetch|network error|network request failed|load failed|网络连接失败|网络错误)/i.test(message || '');
}

function classifyError(status: number | undefined, error: unknown, record: UnknownRecord | null, message: string | undefined): NormalizedApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  if (status !== undefined && status >= 500) return 'server';
  if (status !== undefined) return 'http';
  if (isTimeout(record, message)) return 'timeout';
  if (isNetworkError(error, record, message)) return 'network';
  return 'unknown';
}

function safeMessage(kind: NormalizedApiErrorKind, status: number | undefined): string {
  switch (kind) {
    case 'unauthorized':
      return '登录状态已失效，请重新登录。';
    case 'forbidden':
      return '当前账号没有执行此操作的权限。';
    case 'conflict':
      return '当前数据存在冲突，请检查后重试。';
    case 'validation':
      return '提交内容未通过校验，请检查表单后重试。';
    case 'server':
      return '服务暂时不可用，请稍后重试。';
    case 'http':
      return status === undefined ? '请求失败，请检查后重试。' : `请求失败（HTTP ${status}），请检查后重试。`;
    case 'network':
      return '网络连接失败，请检查网络后重试。';
    case 'timeout':
      return '请求超时，请稍后重试。';
    case 'unknown':
    default:
      return '操作失败，请稍后重试。';
  }
}

/**
 * Parse existing ApiHttpError and legacy response shapes into a stable contract.
 * Raw server text is retained for future presenters, but safeMessage is the only
 * normalized message intended for direct user display.
 */
export function normalizeApiError(error: unknown): NormalizedApiError {
  const record = asRecord(error);
  const payloadValue = record?.['payload'];
  const payload = asRecord(payloadValue);
  const envelope = asRecord(payload?.['error']);
  const status = readStatus(record);
  const code = firstNonEmptyString(envelope?.['code'], payload?.['code']);
  const detailValue = payload?.['detail'];
  const message = firstNonEmptyString(
    envelope?.['message'],
    payload?.['message'],
    typeof detailValue === 'string' ? detailValue : undefined,
    typeof payloadValue === 'string' ? payloadValue : undefined,
    typeof record?.['message'] === 'string' ? record['message'] : undefined,
    typeof error === 'string' ? error : undefined,
  );
  const details = readDetails(envelope, payload) ?? (Array.isArray(payloadValue) ? payloadValue : undefined);
  const kind = classifyError(status, error, record, message);

  return {
    kind,
    ...(status !== undefined ? { status } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(details !== undefined ? { details } : {}),
    safeMessage: safeMessage(kind, status),
    fieldIssues: normalizeFieldIssues(details),
  };
}
