import { requestRemote } from './http.ts';
import { API_ASSETS, type MockApiAsset, type ApiAssetParam, type ApiAssetResponseField, type ApiAssetRelation } from '../data/apiAssets.ts';
import { SYSTEMS, type MockSystem } from '../data/systems.ts';

const remote = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase() === 'remote';

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }
}

let store: MockApiAsset[] = clone(API_ASSETS as MockApiAsset[]);

export interface ApiAssetQueryParams {
  keyword?: string | undefined;
  status?: string | undefined;
  method?: string | undefined;
  downstreamSystemId?: string | number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  [key: string]: unknown;
}

export interface ApiAssetFacets {
  status: Record<string, number>;
  method: Record<string, number>;
  downstreamSystemId: Record<string, number>;
}

export interface ApiAssetPage {
  items: MockApiAsset[];
  total: number;
  page: number;
  pageSize: number;
  facets: ApiAssetFacets;
  stats: { total: number };
}

interface ApiAssetListEnvelope {
  items?: MockApiAsset[] | undefined;
}

function normalizeApiAssetPage(payload: unknown): ApiAssetPage {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('API 资产分页接口返回格式无效');
  }
  const value = payload as Record<string, unknown>;
  const facets = value['facets'];
  if (
    !Array.isArray(value['items']) ||
    !Number.isSafeInteger(value['total']) || Number(value['total']) < 0 ||
    !Number.isSafeInteger(value['page']) || Number(value['page']) < 1 ||
    !Number.isSafeInteger(value['pageSize']) || Number(value['pageSize']) < 1 ||
    !facets || typeof facets !== 'object' || Array.isArray(facets) ||
    !value['stats'] || typeof value['stats'] !== 'object' || Array.isArray(value['stats']) ||
    !Number.isSafeInteger((value['stats'] as Record<string, unknown>)['total']) ||
    Number((value['stats'] as Record<string, unknown>)['total']) < 0
  ) throw new Error('API 资产分页接口返回格式无效');
  const facetRecord = facets as Record<string, unknown>;
  const normalizeCounts = (candidate: unknown): Record<string, number> => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('API 资产分页统计返回格式无效');
    }
    const result: Record<string, number> = {};
    for (const [key, count] of Object.entries(candidate as Record<string, unknown>)) {
      if (!Number.isSafeInteger(count) || Number(count) < 0) {
        throw new Error('API 资产分页统计返回格式无效');
      }
      result[key] = Number(count);
    }
    return result;
  };
  return {
    items: value['items'] as MockApiAsset[],
    total: Number(value['total']),
    page: Number(value['page']),
    pageSize: Number(value['pageSize']),
    facets: {
      status: normalizeCounts(facetRecord['status']),
      method: normalizeCounts(facetRecord['method']),
      downstreamSystemId: normalizeCounts(facetRecord['downstreamSystemId']),
    },
    stats: { total: Number((value['stats'] as Record<string, unknown>)['total']) },
  };
}

interface SystemsListEnvelope {
  items?: MockSystem[] | undefined;
}

export async function getApiAssetPage(params: ApiAssetQueryParams = {}): Promise<ApiAssetPage> {
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const requestedPageSize = Math.max(1, Number(params.pageSize) || 20);
  if (remote) {
    return normalizeApiAssetPage(await requestRemote<unknown>('/api-assets/page', {
      params: { ...params, page: requestedPage, pageSize: requestedPageSize },
    }));
  }
  const all = store.filter((item) => !params.status || item.status === params.status)
    .filter((item) => !params.method || item.method === params.method)
    .filter((item) => !params.downstreamSystemId || String(item.downstreamSystemId) === String(params.downstreamSystemId))
    .filter((item) => {
      const keyword = String(params.keyword || '').trim().toLowerCase();
      return !keyword || [item.code, item.name, item.path, item.description, item.ownerName,
        item.ownerDept, item.downstreamSystemName, item.downstreamSystemShortName]
        .some((value) => String(value || '').toLowerCase().includes(keyword));
    })
    .sort((left, right) => left.code.localeCompare(right.code));
  const lastPage = Math.max(1, Math.ceil(all.length / requestedPageSize));
  const page = Math.min(requestedPage, lastPage);
  const facets: ApiAssetFacets = { status: {}, method: {}, downstreamSystemId: {} };
  for (const item of store) {
    facets.status[item.status] = (facets.status[item.status] || 0) + 1;
    facets.method[item.method] = (facets.method[item.method] || 0) + 1;
    if (item.downstreamSystemId != null) {
      const key = String(item.downstreamSystemId);
      facets.downstreamSystemId[key] = (facets.downstreamSystemId[key] || 0) + 1;
    }
  }
  return {
    items: clone(all.slice((page - 1) * requestedPageSize, page * requestedPageSize)),
    total: all.length,
    page,
    pageSize: requestedPageSize,
    facets,
    stats: { total: store.length },
  };
}

export async function getApiAsset(code: string): Promise<MockApiAsset> {
  if (remote) {
    const payload = await requestRemote<unknown>(`/api-assets/${encodeURIComponent(code)}`);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      const item = record['data'] ?? payload;
      if (item && typeof item === 'object' && !Array.isArray(item)) return item as MockApiAsset;
    }
    throw new Error('API 资产详情接口返回格式无效');
  }
  const item = store.find((entry) => entry.code === code);
  if (!item) throw new Error('API asset not found');
  return clone(item);
}

export async function getApiAssets(params: ApiAssetQueryParams = {}): Promise<MockApiAsset[]> {
  if (remote) {
    const r = await requestRemote<ApiAssetListEnvelope>('/api-assets', { params });
    return r.items || [];
  }
  const q = String(params.keyword || '').toLowerCase();
  return clone(
    store.filter(
      (x) =>
        (!params.status || x.status === params.status) &&
        (!params.method || x.method === params.method) &&
        (!params.downstreamSystemId || String(x.downstreamSystemId) === String(params.downstreamSystemId)) &&
        (!q ||
          [
            x.code,
            x.name,
            x.path,
            x.description,
            x.ownerName,
            x.downstreamSystemName,
            x.downstreamSystemShortName,
          ].some((v) => String(v || '').toLowerCase().includes(q))),
    ),
  );
}

export async function getApiDownstreamSystems(keyword = ''): Promise<MockSystem[]> {
  if (remote) {
    const r = await requestRemote<SystemsListEnvelope>('/api-assets/systems', { params: { keyword } });
    return r.items || [];
  }
  const q = String(keyword).trim().toLowerCase();
  return clone(
    SYSTEMS.filter(
      (x) => !q || [x.name, x.short_name, x.code].some((v) => String(v || '').toLowerCase().includes(q)),
    ),
  );
}

export async function saveApiAsset(code: string | undefined | null, payload: MockApiAsset): Promise<MockApiAsset> {
  if (remote) {
    return requestRemote<MockApiAsset>(code ? `/api-assets/${encodeURIComponent(code)}` : '/api-assets', {
      method: code ? 'PUT' : 'POST',
      body: payload,
    });
  }
  if (code) {
    store = store.map((x) => (x.code === code ? clone(payload) : x));
  } else {
    if (store.some((x) => x.code === payload.code)) {
      throw new Error('API 编码已存在');
    }
    store = [clone(payload), ...store];
  }
  return clone(payload);
}

export async function deleteApiAsset(code: string): Promise<void> {
  if (remote) {
    return requestRemote<void>(`/api-assets/${encodeURIComponent(code)}`, { method: 'DELETE' });
  }
  store = store.filter((x) => x.code !== code);
}

export async function setApiAssetStatus(code: string, status: string): Promise<MockApiAsset | undefined> {
  if (remote) {
    return requestRemote<MockApiAsset>(`/api-assets/${encodeURIComponent(code)}/status`, {
      method: 'PATCH',
      body: { status },
    });
  }
  const item = store.find((x) => x.code === code);
  if (item) item.status = status;
  return clone(item);
}

export type ApiAssetRowKey = 'params' | 'responseFields' | 'relations';
export type ApiAssetRowItems<K extends ApiAssetRowKey> =
  K extends 'params' ? ApiAssetParam[] :
  K extends 'responseFields' ? ApiAssetResponseField[] :
  K extends 'relations' ? ApiAssetRelation[] : never;

export async function replaceApiAssetRows<K extends ApiAssetRowKey>(
  code: string,
  key: K,
  items: ApiAssetRowItems<K>,
): Promise<MockApiAsset | undefined> {
  const endpoints: Record<ApiAssetRowKey, string> = {
    params: 'params',
    responseFields: 'response-fields',
    relations: 'relations',
  };
  if (remote) {
    return requestRemote<MockApiAsset>(`/api-assets/${encodeURIComponent(code)}/${endpoints[key]}`, {
      method: 'PUT',
      body: { items },
    });
  }
  const item = store.find((x) => x.code === code);
  if (item) {
    if (key === 'params') item.params = clone(items) as ApiAssetParam[];
    else if (key === 'responseFields') item.responseFields = clone(items) as ApiAssetResponseField[];
    else if (key === 'relations') item.relations = clone(items) as ApiAssetRelation[];
  }
  return clone(item);
}
