import Taro, { useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { getPortalStats, PortalStat } from '../../api/portal'
import { BottomTabBar } from '../../components/BottomTabBar'
import { SearchBar } from '../../components/SearchBar'
import { SectionHeader } from '../../components/SectionHeader'
import { StateView } from '../../components/StateView'
import { StatCard } from '../../components/StatCard'
import { ROUTES, withQuery } from '../../routes'
import { PENDING_INDICATOR_KEY, RecentItem, readRecentItems } from '../../utils/recent'

const STAT_CARDS = [
  { key: 'asset_table', label: '数据表' },
  { key: 'field', label: '字段' },
  { key: 'indicator', label: '指标' },
  { key: 'report', label: '报表' },
]

export default function HomePage() {
  const [query, setQuery] = useState('')
  const [stats, setStats] = useState([] as PortalStat[])
  const [recent, setRecent] = useState([] as RecentItem[])
  const [status, setStatus] = useState('loading')

  const load = async () => {
    setStatus('loading')
    try {
      setStats(await getPortalStats())
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  useDidShow(() => {
    setRecent(readRecentItems())
    void load()
  })

  const search = () => {
    Taro.navigateTo({ url: withQuery(ROUTES.search, { q: query }) })
  }

  const openIndicator = (id: string) => {
    Taro.setStorageSync(PENDING_INDICATOR_KEY, id)
    Taro.switchTab({ url: ROUTES.indicators })
  }

  const statByKey = new Map(stats.map((item) => [item.key, item.value]))

  return (
    <View className="app-page home-page">
      <View className="page-heading">
        <View>
          <Text className="page-title">数据资产</Text>
          <Text className="page-subtitle">随身数据资产目录</Text>
        </View>
      </View>
      <View className="home-hero">
        <Text className="home-caption">搜索表、字段、指标、报表、API</Text>
        <SearchBar value={query} placeholder="搜索数据资产" onChange={setQuery} onSearch={search} />
      </View>

      <SectionHeader title="资产概览" />
      {status === 'loading' ? <StateView status="loading" /> : null}
      {status === 'error' ? <StateView status="error" onRetry={load} /> : null}
      {status === 'success' ? (
        <View className="stats-grid">
          {STAT_CARDS.map((card) => (
            <StatCard key={card.key} label={card.label} value={statByKey.has(card.key) ? String(statByKey.get(card.key)) : '—'} />
          ))}
        </View>
      ) : null}

      <SectionHeader title="常用入口" />
      <View className="shortcut-grid">
        <View className="shortcut-button" onClick={() => Taro.switchTab({ url: ROUTES.assets })}><Text className="shortcut-glyph">▦</Text><Text>数据表</Text></View>
        <View className="shortcut-button" onClick={() => Taro.switchTab({ url: ROUTES.indicators })}><Text className="shortcut-glyph">◈</Text><Text>指标</Text></View>
        <View className="shortcut-button" onClick={() => Taro.navigateTo({ url: withQuery(ROUTES.search, { scope: 'report' }) })}><Text className="shortcut-glyph">▤</Text><Text>报表</Text></View>
        <View className="shortcut-button" onClick={() => Taro.navigateTo({ url: withQuery(ROUTES.search, { scope: 'api' }) })}><Text className="shortcut-glyph">⌘</Text><Text>API</Text></View>
      </View>

      <SectionHeader title="最近查看" extra={recent.length ? `${recent.length} 条` : undefined} />
      <View className="content-card">
        {!recent.length ? <StateView status="empty" message="浏览过的数据资产和指标会显示在这里" /> : null}
        {recent.map((item) => (
          <View
            className="recent-card"
            key={`${item.type}-${item.id}`}
            onClick={() => item.type === 'asset'
              ? Taro.navigateTo({ url: withQuery(ROUTES.assetDetail, { table: item.id }) })
              : openIndicator(item.id)}
          >
            <Text className="recent-type">{item.type === 'asset' ? '数据表' : '指标'}</Text>
            <View className="recent-copy"><Text className="recent-title">{item.title}</Text><Text className="recent-subtitle">{item.subtitle}</Text></View>
            <Text className="section-extra">›</Text>
          </View>
        ))}
      </View>
      <BottomTabBar current="home" />
    </View>
  )
}
