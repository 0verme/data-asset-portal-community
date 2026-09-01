import { requestJson } from './http'

export interface AssetField {
  fieldId: number | null
  assetId: number | null
  name: string
  cn: string
  type: string
  nullable: boolean
  pk: boolean
  part: boolean
}

export interface Asset {
  assetId: number | null
  name: string
  cn: string
  domain: string
  layer: string
  owner: string
  grain: string
  cycle: string
  desc: string
  schema: string
  fieldCount: number
  fields: AssetField[]
  updatedAt?: string
}

export interface AssetPage {
  items: Asset[]
  page: number
  pageSize: number
  total: number
}

function recordOf(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function numberOrNull(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export function mapAssetField(payload: unknown): AssetField {
  const item = recordOf(payload)
  return {
    fieldId: numberOrNull(item.fieldId ?? item.field_id),
    assetId: numberOrNull(item.assetId ?? item.asset_id),
    name: stringValue(item.name),
    cn: stringValue(item.cn ?? item.comment),
    type: stringValue(item.type),
    nullable: Boolean(item.nullable),
    pk: Boolean(item.pk),
    part: Boolean(item.part),
  }
}

export function mapAsset(payload: unknown): Asset {
  const item = recordOf(payload)
  const fields = Array.isArray(item.fields) ? item.fields.map(mapAssetField) : []
  return {
    assetId: numberOrNull(item.assetId ?? item.asset_id),
    name: stringValue(item.name ?? item.tableName),
    cn: stringValue(item.cn ?? item.tableCnName ?? item.name),
    domain: stringValue(item.domain),
    layer: stringValue(item.layer ?? item.tier),
    owner: stringValue(item.owner ?? item.ownerName),
    grain: stringValue(item.grain),
    cycle: stringValue(item.cycle),
    desc: stringValue(item.desc ?? item.description),
    schema: stringValue(item.schema ?? item.schemaName),
    fieldCount: Number(item.fieldCount) || fields.length,
    fields,
    updatedAt: item.updatedAt ? stringValue(item.updatedAt) : undefined,
  }
}

function rowsFrom(payload: unknown) {
  const record = recordOf(payload)
  if (Array.isArray(payload)) return payload
  if (Array.isArray(record.items)) return record.items
  if (Array.isArray(record.data)) return record.data
  return []
}

export function mapAssetPage(payload: unknown, fallbackPage = 1, fallbackPageSize = 20): AssetPage {
  const record = recordOf(payload)
  return {
    items: rowsFrom(payload).map(mapAsset),
    page: Number(record.page) || fallbackPage,
    pageSize: Number(record.pageSize) || fallbackPageSize,
    total: Number(record.total) || 0,
  }
}

export function mapAssetDetail(payload: unknown) {
  const record = recordOf(payload)
  return mapAsset(record.data && typeof record.data === 'object' ? record.data : payload)
}

export function mapAssetFields(payload: unknown) {
  return rowsFrom(payload).map(mapAssetField)
}

export function mapAssetDdl(payload: unknown) {
  const record = recordOf(payload)
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
  return {
    ddl: stringValue(data.ddl),
    dialect: stringValue(data.ddlDialectLabel || data.ddlDialect),
  }
}

export interface AssetFilterOption {
  value: string
  label: string
}

export function mapAssetFilterOptions(payload: unknown, kind: 'layers' | 'domains'): AssetFilterOption[] {
  return rowsFrom(payload).flatMap((row) => {
    const item = recordOf(row)
    const value = kind === 'layers' ? stringValue(item.code) : stringValue(item.name)
    const label = kind === 'layers' ? stringValue(item.cn || item.code) : stringValue(item.name)
    return value ? [{ value, label: label || value }] : []
  })
}

export async function getAssetPage(params: { layer?: string; domain?: string; keyword?: string; page?: number; pageSize?: number }) {
  const page = params.page || 1
  const pageSize = params.pageSize || 10
  return mapAssetPage(await requestJson('/assets/tables', {
    params: { ...params, page, pageSize, summary: 'true' },
  }), page, pageSize)
}

export async function getAssetDetail(tableName: string) {
  return mapAssetDetail(await requestJson(`/assets/tables/${encodeURIComponent(tableName)}`))
}

export async function getAssetFields(tableName: string) {
  return mapAssetFields(await requestJson(`/assets/tables/${encodeURIComponent(tableName)}/fields`))
}

export async function getAssetDdl(tableName: string) {
  return mapAssetDdl(await requestJson(`/assets/tables/${encodeURIComponent(tableName)}/ddl`, { timeout: 15000 }))
}

export async function getAssetLayers() {
  return mapAssetFilterOptions(await requestJson('/assets/layers'), 'layers')
}

export async function getAssetDomains(layer?: string) {
  return mapAssetFilterOptions(await requestJson('/assets/domains', { params: { layer } }), 'domains')
}
