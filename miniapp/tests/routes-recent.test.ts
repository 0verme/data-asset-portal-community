import assert from 'node:assert/strict'
import test from 'node:test'
import { ROUTES, withQuery } from '../src/routes'
import { normalizeRecentItems } from '../src/utils/recent-utils'
import { getStatusMeta } from '../src/utils/status'

test('route constants keep the five-page navigation contract', () => {
  assert.equal(ROUTES.home, '/pages/home/index')
  assert.equal(ROUTES.search, '/pages/search/index')
  assert.equal(ROUTES.assets, '/pages/assets/index')
  assert.equal(ROUTES.assetDetail, '/pages/asset-detail/index')
  assert.equal(ROUTES.indicators, '/pages/indicators/index')
  assert.equal(withQuery(ROUTES.assetDetail, { table: 'dwm order', empty: '' }), '/pages/asset-detail/index?table=dwm%20order')
})

test('recent storage mapper keeps only safe read-only fields', () => {
  const result = normalizeRecentItems([
    { id: 'dwm_order', type: 'asset', title: '订单表', subtitle: 'dwm_order', visitedAt: 10, secret: 'must drop' },
    { id: 'I1', type: 'indicator', title: '订单数', subtitle: '订单', visitedAt: 9 },
    { id: 'bad', type: 'user', title: '不支持', subtitle: '', visitedAt: 8 },
  ])
  assert.deepEqual(result, [
    { id: 'dwm_order', type: 'asset', title: '订单表', subtitle: 'dwm_order', visitedAt: 10 },
    { id: 'I1', type: 'indicator', title: '订单数', subtitle: '订单', visitedAt: 9 },
  ])
})

test('status mapper keeps runtime and lifecycle semantics distinct', () => {
  assert.deepEqual(getStatusMeta('runtime', 'disabled'), { label: '已禁用', tone: 'danger' })
  assert.deepEqual(getStatusMeta('semantic', 'certified'), { label: '已认证', tone: 'ok' })
  assert.equal(getStatusMeta('runtime', 'certified'), undefined)
})
