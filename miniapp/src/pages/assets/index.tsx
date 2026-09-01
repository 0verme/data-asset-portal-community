import Taro, { useLoad } from '@tarojs/taro'
import { Button, Picker, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Asset, AssetFilterOption, getAssetDomains, getAssetLayers, getAssetPage } from '../../api/assets'
import { AssetCard } from '../../components/AssetCard'
import { BottomTabBar } from '../../components/BottomTabBar'
import { SearchBar } from '../../components/SearchBar'
import { StateView } from '../../components/StateView'
import { ROUTES, withQuery } from '../../routes'

function FilterPicker({ label, value, options, onChange }: { label: string; value: string; options: AssetFilterOption[]; onChange: (value: string) => void }) {
  const values = [{ value: '', label }, ...options]
  const selected = Math.max(0, values.findIndex((item) => item.value === value))
  return (
    <Picker mode="selector" range={values.map((item) => item.label)} value={selected} onChange={(event) => onChange(values[Number(event.detail.value)]?.value || '')}>
      <View className={`filter-chip ${value ? 'filter-chip-active' : ''}`}>{values[selected]?.label || label}⌄</View>
    </Picker>
  )
}

export default function AssetsPage() {
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [layer, setLayer] = useState('')
  const [domain, setDomain] = useState('')
  const [layers, setLayers] = useState([] as AssetFilterOption[])
  const [domains, setDomains] = useState([] as AssetFilterOption[])
  const [items, setItems] = useState([] as Asset[])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useLoad((options) => {
    if (options?.keyword) {
      const initialKeyword = String(options.keyword)
      setInput(initialKeyword)
      setKeyword(initialKeyword)
    }
  })

  useEffect(() => {
    let active = true
    void Promise.all([getAssetLayers(), getAssetDomains(layer)]).then(([nextLayers, nextDomains]) => {
      if (!active) return
      setLayers(nextLayers)
      setDomains(nextDomains)
    }).catch(() => {
      if (active) setDomains([])
    })
    return () => { active = false }
  }, [layer])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setPage(1)
    void getAssetPage({ layer, domain, keyword, page: 1 }).then((result) => {
      if (!active) return
      setItems(result.items)
      setTotal(result.total)
      setStatus('success')
    }).catch(() => {
      if (active) setStatus('error')
    })
    return () => { active = false }
  }, [layer, domain, keyword, reloadTick])

  const loadMore = () => {
    if (loadingMore || items.length >= total) return
    setLoadingMore(true)
    setLoadMoreError(false)
    const nextPage = page + 1
    void getAssetPage({ layer, domain, keyword, page: nextPage }).then((result) => {
      setItems((current) => [...current, ...result.items])
      setPage(nextPage)
      setTotal(result.total)
    }).catch(() => setLoadMoreError(true)).finally(() => setLoadingMore(false))
  }

  const applySearch = () => setKeyword(input.trim())

  return (
    <View className="app-page assets-page">
      <View className="page-heading"><Text className="page-title">数据表</Text></View>
      <SearchBar value={input} placeholder="搜索中文名、英文表名、负责人" onChange={setInput} onSearch={applySearch} />
      <View className="filter-row">
        <FilterPicker label="全部层级" value={layer} options={layers} onChange={(value) => { setLayer(value); setDomain('') }} />
        <FilterPicker label="全部主题域" value={domain} options={domains} onChange={setDomain} />
        <Text className="filter-unavailable">状态：接口未提供</Text>
      </View>
      {status === 'loading' ? <StateView status="loading" /> : null}
      {status === 'error' ? <StateView status="error" onRetry={() => setReloadTick((value) => value + 1)} /> : null}
      {status === 'success' && !items.length ? <StateView status="empty" message="没有找到符合条件的数据表" /> : null}
      {status === 'success' && items.length ? (
        <View>
          <Text className="assets-total">已加载 {items.length} / {total} 张数据表</Text>
          <View className="section-header"><Text className="section-title">资产列表</Text></View>
          {items.map((asset) => <AssetCard key={asset.name} asset={asset} onView={() => Taro.navigateTo({ url: withQuery(ROUTES.assetDetail, { table: asset.name }) })} />)}
          {items.length < total ? <Button className="load-more-button" onClick={loadMore}>{loadingMore ? '加载中…' : '加载更多'}</Button> : null}
          {loadMoreError ? <StateView status="error" message="加载更多失败，请稍后重试" onRetry={loadMore} /> : null}
        </View>
      ) : null}
      <BottomTabBar current="assets" />
    </View>
  )
}
