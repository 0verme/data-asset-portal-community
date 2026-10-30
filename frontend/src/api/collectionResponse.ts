/**
 * Parse the collection envelopes documented by the backend API.
 *
 * A bare array is used by a small number of legacy tree endpoints; other list
 * routes return `{ items: [...] }`. Empty arrays are valid data. Anything else
 * is a contract error and must not be presented as an empty collection.
 */
export function parseCollectionResponse<T>(payload: unknown, resource: string): T[] {
  if (Array.isArray(payload)) return payload as T[];

  if (payload && typeof payload === 'object') {
    const items = (payload as Record<string, unknown>)['items'];
    if (Array.isArray(items)) return items as T[];
  }

  throw new Error(`${resource}接口返回格式无效：预期数组或 items 数组`);
}
