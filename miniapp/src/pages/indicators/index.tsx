import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { getIndicatorDetail, getIndicatorList, Indicator } from '../../api/indicators'
import { BottomTabBar } from '../../components/BottomTabBar'
import { IndicatorCard } from '../../components/IndicatorCard'
import { SearchBar } from '../../components/SearchBar'
import { StateView } from '../../components/StateView'
import { addRecentItem, PENDING_INDICATOR_KEY } from '../../utils/recent'

export default function IndicatorsPage() {
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState([] as Indicator[])
  const [details, setDetails] = useState({} as Record<string, Indicator>)
  const [detailErrors, setDetailErrors] = useState({} as Record<string, boolean>)
  const [expandedId, setExpandedId] = useState('')
  const [detailLoadingId, setDetailLoadingId] = useState('')
  const [status, setStatus] = useState('loading')

  useLoad((options) => {
    if (options?.indicator) setExpandedId(String(options.indicator))
  })

  const load = async (requestedKeyword = keyword) => {
    setStatus('loading')
    try {
      const nextItems = await getIndicatorList(requestedKeyword)
      setItems(nextItems)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  useDidShow(() => {
    const pendingIndicator = String(Taro.getStorageSync(PENDING_INDICATOR_KEY) || '')
    if (pendingIndicator) {
      setExpandedId(pendingIndicator)
      Taro.removeStorageSync(PENDING_INDICATOR_KEY)
    }
    void load()
  })

  const applySearch = () => {
    const nextKeyword = input.trim()
    setKeyword(nextKeyword)
    void load(nextKeyword)
  }

  const toggleDetail = (item: Indicator) => {
    if (expandedId === item.id) {
      setExpandedId('')
      return
    }
    setExpandedId(item.id)
    addRecentItem({ id: item.id, type: 'indicator', title: item.name || item.id, subtitle: item.meaning })
    if (details[item.id]) return
    setDetailErrors((current) => ({ ...current, [item.id]: false }))
    setDetailLoadingId(item.id)
    void getIndicatorDetail(item.id).then((detail) => {
      setDetails((current) => ({ ...current, [item.id]: detail }))
    }).catch(() => {
      setDetailErrors((current) => ({ ...current, [item.id]: true }))
    }).finally(() => setDetailLoadingId(''))
  }

  return (
    <View className="app-page indicators-page">
      <View className="page-heading"><Text className="page-title">指标中心</Text></View>
      <SearchBar value={input} placeholder="搜索指标名称、口径、来源表" onChange={setInput} onSearch={applySearch} />
      {status === 'loading' ? <StateView status="loading" /> : null}
      {status === 'error' ? <StateView status="error" onRetry={load} /> : null}
      {status === 'success' && !items.length ? <StateView status="empty" message="没有找到匹配指标" /> : null}
      {status === 'success' && items.length ? (
        <View>
          <Text className="indicator-summary">共 {items.length} 个指标</Text>
          <View className="section-header"><Text className="section-title">指标列表</Text></View>
          {items.map((item) => {
            const indicator = details[item.id] || item
            return <IndicatorCard key={item.id} indicator={indicator} expanded={expandedId === item.id} detailLoading={detailLoadingId === item.id} detailError={Boolean(detailErrors[item.id])} onToggle={() => toggleDetail(item)} />
          })}
        </View>
      ) : null}
      <BottomTabBar current="indicators" />
    </View>
  )
}
