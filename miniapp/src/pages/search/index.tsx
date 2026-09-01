import Taro, { useLoad } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { SearchGroup, SearchItem, searchCatalog } from '../../api/search'
import { BottomTabBar } from '../../components/BottomTabBar'
import { SearchBar } from '../../components/SearchBar'
import { StateView } from '../../components/StateView'
import { ROUTES, SEARCH_SCOPES, withQuery } from '../../routes'
import { PENDING_INDICATOR_KEY } from '../../utils/recent'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [groups, setGroups] = useState([] as SearchGroup[])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('initial')
  const requestId = useRef(0)

  useLoad((options) => {
    if (options?.q) setQuery(String(options.q))
    if (options?.scope) setScope(String(options.scope))
  })

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setGroups([])
      setTotal(0)
      setStatus('initial')
      return undefined
    }
    const currentRequest = ++requestId.current
    setStatus('loading')
    const timer = setTimeout(() => {
      void searchCatalog(keyword, scope).then((result) => {
        if (currentRequest !== requestId.current) return
        setGroups(result.groups)
        setTotal(result.total)
        setStatus('success')
      }).catch(() => {
        if (currentRequest === requestId.current) setStatus('error')
      })
    }, 320)
    return () => clearTimeout(timer)
  }, [query, scope])

  const retry = () => {
    setQuery((value) => `${value}`)
  }

  const openItem = (group: SearchGroup, item: SearchItem) => {
    const ref = typeof item.ref === 'string' ? item.ref : ''
    if (group.type === 'asset' && ref) Taro.navigateTo({ url: withQuery(ROUTES.assetDetail, { table: ref }) })
    if (group.type === 'field' && ref) Taro.navigateTo({ url: withQuery(ROUTES.assetDetail, { table: ref }) })
    if (group.type === 'indicator' && ref) {
      Taro.setStorageSync(PENDING_INDICATOR_KEY, ref)
      Taro.switchTab({ url: ROUTES.indicators })
    }
  }

  return (
    <View className="app-page search-page">
      <View className="page-heading"><Text className="page-title">全局搜索</Text></View>
      <SearchBar value={query} placeholder="搜索表、字段、指标、报表、API" onChange={setQuery} onSearch={() => setQuery((value) => `${value}`)} />
      <View className="scope-row">
        {SEARCH_SCOPES.map((item) => (
          <Button key={item.value} className={`scope-chip ${scope === item.value ? 'scope-chip-active' : ''}`} onClick={() => setScope(item.value)}>{item.label}</Button>
        ))}
      </View>
      {status === 'initial' ? <StateView status="empty" message="输入关键词开始查找数据资产" /> : null}
      {status === 'loading' ? <StateView status="loading" /> : null}
      {status === 'error' ? <StateView status="error" onRetry={retry} /> : null}
      {status === 'success' && !groups.length ? <StateView status="empty" message="没有找到匹配结果" /> : null}
      {status === 'success' && groups.length ? (
        <View>
          <Text className="search-summary">共找到 {total} 条结果</Text>
          {groups.map((group) => (
            <View key={`${group.type}-${group.module}`}>
              <View className="section-header"><Text className="section-title">{group.label}</Text><Text className="section-extra">{group.count} 条</Text></View>
              {group.items.map((item) => (
                <View className="content-card result-card" key={`${group.type}-${item.id}`} onClick={() => openItem(group, item)}>
                  <View className="card-title-row"><Text className="card-title">{item.title}</Text><Text className="result-type">{group.label}</Text></View>
                  <Text className="card-subtitle">{item.subtitle}</Text>
                  {item.meta ? <Text className="card-description">{item.meta}</Text> : null}
                  {typeof item.ref === 'string' ? <Text className="result-ref">{item.ref}</Text> : null}
                  {item.matchedFields.map((match) => <Text className="matched-field" key={`${match.label}-${match.value}`}>命中：{match.label} · {match.value}</Text>)}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <BottomTabBar current="home" />
    </View>
  )
}
