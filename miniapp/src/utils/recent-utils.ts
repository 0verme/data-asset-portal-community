export interface RecentItem {
  id: string
  type: 'asset' | 'indicator'
  title: string
  subtitle: string
  visitedAt: number
}

export const RECENT_STORAGE_KEY = 'data-asset-portal-miniapp:recent'
export const PENDING_INDICATOR_KEY = 'data-asset-portal-miniapp:pending-indicator'

export function normalizeRecentItems(value: unknown): RecentItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (!record.id || (record.type !== 'asset' && record.type !== 'indicator')) return []
    return [{
      id: String(record.id),
      type: record.type,
      title: String(record.title || ''),
      subtitle: String(record.subtitle || ''),
      visitedAt: Number(record.visitedAt) || 0,
    }]
  })
}
