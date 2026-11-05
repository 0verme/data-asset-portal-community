export interface SystemManagementPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SystemManagementPageQuery {
  page: number;
  pageSize: number;
  keyword?: string | undefined;
}

export function systemManagementPageUrl(
  endpoint: string,
  query: SystemManagementPageQuery,
  extra?: Readonly<Record<string, string | undefined>>,
): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  const keyword = String(query.keyword || '').trim();
  if (keyword) params.set('keyword', keyword);
  for (const [key, value] of Object.entries(extra || {})) {
    if (value) params.set(key, value);
  }
  return `${endpoint}?${params.toString()}`;
}

export function normalizeSystemManagementPage<T>(payload: unknown, context: string): SystemManagementPage<T> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${context}接口返回格式无效：分页响应必须包含 items`);
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record['items'])) {
    throw new Error(`${context}接口返回格式无效：分页响应必须包含 items`);
  }
  if (
    !Number.isSafeInteger(record['total']) ||
    !Number.isSafeInteger(record['page']) ||
    !Number.isSafeInteger(record['pageSize']) ||
    Number(record['total']) < 0 ||
    Number(record['page']) < 1 ||
    Number(record['pageSize']) < 1
  ) {
    throw new Error(`${context}接口返回格式无效：缺少分页元数据`);
  }
  return {
    items: record['items'] as T[],
    total: Number(record['total']),
    page: Number(record['page']),
    pageSize: Number(record['pageSize']),
  };
}

export function sliceSystemManagementPage<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): SystemManagementPage<T> {
  const normalizedPage = Math.max(1, Math.trunc(page) || 1);
  const normalizedPageSize = Math.max(1, Math.trunc(pageSize) || 20);
  const start = (normalizedPage - 1) * normalizedPageSize;
  return {
    items: items.slice(start, start + normalizedPageSize) as T[],
    total: items.length,
    page: normalizedPage,
    pageSize: normalizedPageSize,
  };
}
