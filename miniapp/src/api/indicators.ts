import { requestJson } from './http'

export interface Indicator {
  id: string
  name: string
  meaning: string
  resultTableName: string
  resultFieldName: string
  sourceAssetName: string
  sourceAssetQualifiedName: string
  aggregation: string
  semanticState: string
  dimension: string
  caliber: string
  path: string
  status: string
  registrar: string
  registeredAt: string
}

function recordOf(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function firstPresent(item: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = item[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return fallback
}

export function mapIndicator(payload: unknown): Indicator {
  const item = recordOf(payload)
  return {
    id: stringValue(item.id ?? item.indicatorId),
    name: stringValue(item.name ?? item.indicatorName),
    meaning: stringValue(item.meaning ?? item.meaningDesc),
    resultTableName: stringValue(firstPresent(item, ['resultTableName', 'result_table_name', 'resultTable'])),
    resultFieldName: stringValue(firstPresent(item, ['resultFieldName', 'result_field_name', 'resultField'])),
    sourceAssetName: stringValue(firstPresent(item, ['sourceAssetName', 'source_asset_name'])),
    sourceAssetQualifiedName: stringValue(firstPresent(item, ['sourceAssetQualifiedName', 'source_asset_qualified_name'])),
    aggregation: stringValue(firstPresent(item, ['aggregation', 'aggregationCode', 'aggregation_code'])),
    semanticState: stringValue(firstPresent(item, ['semanticState', 'semantic_state', 'certificationStatus'], 'candidate')) || 'candidate',
    dimension: stringValue(firstPresent(item, ['dimension', 'dimensionCode', 'dimension_code'])),
    caliber: stringValue(item.caliber ?? item.caliberDesc),
    path: stringValue(item.path ?? item.pathDesc),
    status: stringValue(item.status),
    registrar: stringValue(item.registrar ?? item.registrarName),
    registeredAt: stringValue(item.registeredAt ?? item.registeredDate),
  }
}

export function mapIndicatorList(payload: unknown) {
  const record = recordOf(payload)
  const rows = Array.isArray(payload) ? payload : Array.isArray(record.items) ? record.items : []
  return rows.map(mapIndicator)
}

export function mapIndicatorDetail(payload: unknown) {
  const record = recordOf(payload)
  return mapIndicator(record.data && typeof record.data === 'object' ? record.data : payload)
}

export async function getIndicatorList(keyword = '') {
  return mapIndicatorList(await requestJson('/indicators', { params: { keyword: keyword.trim() || undefined } }))
}

export async function getIndicatorDetail(indicatorId: string) {
  return mapIndicatorDetail(await requestJson(`/indicators/${encodeURIComponent(indicatorId)}`))
}
