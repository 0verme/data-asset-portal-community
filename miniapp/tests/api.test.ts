import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApiUrl, normalizeApiError, normalizeBaseUrl } from '../src/api/http-utils'
import { mapAsset, mapAssetDetail, mapAssetFilterOptions, mapAssetPage } from '../src/api/assets'
import { mapIndicator, mapIndicatorList } from '../src/api/indicators'
import { mapPortalStats } from '../src/api/portal'
import { normalizeSearchResponse } from '../src/api/search'

test('API base URL joins paths without duplicate slashes', () => {
  assert.equal(normalizeBaseUrl(' https://catalog.example.com/api/// '), 'https://catalog.example.com/api')
  assert.equal(buildApiUrl('/portal/stats', 'https://catalog.example.com/api/'), 'https://catalog.example.com/api/portal/stats')
  assert.equal(buildApiUrl('search', 'https://catalog.example.com/api'), 'https://catalog.example.com/api/search')
})

test('API errors normalize FastAPI error envelopes', () => {
  const error = normalizeApiError({ statusCode: 422, data: { error: { code: 'VALIDATION_ERROR', message: '参数不正确' } } })
  assert.equal(error.status, 422)
  assert.equal(error.code, 'VALIDATION_ERROR')
  assert.equal(error.message, '参数不正确')
})

test('portal stats mapper keeps backend keys and numeric values', () => {
  assert.deepEqual(mapPortalStats({ items: [{ key: 'asset_table', label: '主题表', value: 12 }, { key: 'field', label: '源字段', value: '72' }] }), [
    { key: 'asset_table', label: '主题表', value: 12 },
    { key: 'field', label: '源字段', value: 72 },
  ])
})

test('search mapper groups supported result types and keeps refs', () => {
  const result = normalizeSearchResponse({ query: 'orders', scope: 'all', total: 2, groups: [
    { type: 'asset', label: '资产', module: 'dwm', count: 1, items: [{ id: 'dwm_order', title: 'dwm_order', subtitle: '订单表', meta: '业务 / DWM', ref: 'dwm_order' }] },
    { type: 'indicator', label: '指标', module: 'indicator', count: 1, items: [{ id: 'I1', title: 'I1', subtitle: '订单数', ref: 'I1' }] },
  ] })
  assert.equal(result.groups[0].label, '数据表')
  assert.equal(result.groups[0].items[0].ref, 'dwm_order')
  assert.equal(result.groups[1].label, '指标')
})

test('asset list/detail mappers support backend envelopes', () => {
  const raw = { assetId: 4, name: 'dwm_order', cn: '订单表', domain: '交易', layer: 'DWM', owner: '数据组', fieldCount: 1, fields: [{ fieldId: 9, name: 'order_id', cn: '订单号', type: 'BIGINT', nullable: false, pk: true, part: false }] }
  const asset = mapAsset(raw)
  assert.equal(asset.fieldCount, 1)
  assert.equal(asset.fields[0].pk, true)
  assert.equal(mapAssetDetail({ data: raw }).name, 'dwm_order')
  assert.equal(mapAssetPage({ items: [raw], page: 2, pageSize: 10, total: 21 }).page, 2)
})

test('asset filter mapper translates real layer and domain envelopes', () => {
  assert.deepEqual(mapAssetFilterOptions({ items: [{ code: 'DWM', cn: '明细层' }] }, 'layers'), [{ value: 'DWM', label: '明细层' }])
  assert.deepEqual(mapAssetFilterOptions({ items: [{ name: '交易域', count: 4 }] }, 'domains'), [{ value: '交易域', label: '交易域' }])
})

test('indicator mapper preserves runtime status separately from lifecycle', () => {
  const indicator = mapIndicator({ id: 'I1', name: '订单数', status: 'disabled', semantic_state: 'certified', dimension_code: 'business', source_asset_name: 'dwm_order' })
  assert.equal(indicator.status, 'disabled')
  assert.equal(indicator.semanticState, 'certified')
  assert.equal(indicator.sourceAssetName, 'dwm_order')
  assert.equal(mapIndicatorList({ items: [{ id: 'I1', name: '订单数' }] }).length, 1)
})
