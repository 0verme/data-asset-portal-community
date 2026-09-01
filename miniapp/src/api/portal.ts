import { requestJson } from './http'

export interface PortalStat {
  key: string
  label: string
  value: number
}

export function mapPortalStats(payload: unknown): PortalStat[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const rows = Array.isArray(payload) ? payload : Array.isArray(record?.items) ? record.items : []
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    if (item.label === undefined) return []
    return [{
      key: String(item.key || ''),
      label: String(item.label),
      value: Number.isFinite(Number(item.value)) ? Number(item.value) : 0,
    }]
  })
}

export async function getPortalStats() {
  return mapPortalStats(await requestJson('/portal/stats'))
}
