export const ROUTES = {
  home: '/pages/home/index',
  search: '/pages/search/index',
  assets: '/pages/assets/index',
  assetDetail: '/pages/asset-detail/index',
  indicators: '/pages/indicators/index',
} as const

export type TabRoute = 'home' | 'assets' | 'indicators'

export const SEARCH_SCOPES = [
  { value: 'all', label: '全部' },
  { value: 'asset', label: '数据表' },
  { value: 'field', label: '字段' },
  { value: 'indicator', label: '指标' },
  { value: 'report', label: '报表' },
  { value: 'api', label: 'API' },
] as const

export function withQuery(route: string, params: Record<string, string | number | undefined>) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return query ? `${route}?${query}` : route
}
