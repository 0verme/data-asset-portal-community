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
  [key: string]: unknown;
}

interface ApiAssetListEnvelope {
  items?: MockApiAsset[] | undefined;
}

interface SystemsListEnvelope {
  items?: MockSystem[] | undefined;
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
