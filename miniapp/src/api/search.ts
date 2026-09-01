import { requestJson } from './http'

export interface SearchItem {
  id: string
  title: string
  subtitle: string
  meta: string
  ref: unknown
  matchedFields: Array<{ label: string; value: string }>
}

export interface SearchGroup {
  type: string
  label: string
  module: string
  count: number
  items: SearchItem[]
}

export interface SearchResponse {
  query: string
  scope: string
  groups: SearchGroup[]
  total: number
  hasMore: boolean
}

const SEARCH_LABELS: Record<string, string> = {
  asset: '数据表',
  field: '字段',
  indicator: '指标',
  report: '报表',
  api: 'API',
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

export function normalizeSearchResponse(payload: unknown): SearchResponse {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const groups = Array.isArray(record.groups) ? record.groups : []
  return {
    query: stringValue(record.query),
    scope: stringValue(record.scope) || 'all',
    total: Number(record.total) || 0,
    hasMore: Boolean(record.hasMore),
    groups: groups.flatMap((group) => {
      if (!group || typeof group !== 'object') return []
      const item = group as Record<string, unknown>
      const type = stringValue(item.type)
      const rows = Array.isArray(item.items) ? item.items : []
      return [{
        type,
        label: SEARCH_LABELS[type] || stringValue(item.label) || type,
        module: stringValue(item.module),
        count: Number(item.count) || rows.length,
        items: rows.flatMap((row) => {
          if (!row || typeof row !== 'object') return []
          const result = row as Record<string, unknown>
          const matchedFields = Array.isArray(result.matchedFields)
            ? result.matchedFields.flatMap((match) => {
              if (!match || typeof match !== 'object') return []
              const entry = match as Record<string, unknown>
              return [{ label: stringValue(entry.label), value: stringValue(entry.value) }]
            })
            : []
          return [{
            id: stringValue(result.id),
            title: stringValue(result.title),
            subtitle: stringValue(result.subtitle),
            meta: stringValue(result.meta),
            ref: result.ref,
            matchedFields,
          }]
        }),
      }]
    }),
  }
}

export async function searchCatalog(query: string, scope = 'all') {
  return normalizeSearchResponse(await requestJson('/search', {
    params: { q: query.trim(), scope: scope === 'all' ? undefined : scope, limit: 10 },
  }))
}
