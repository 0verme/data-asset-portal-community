import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { ROUTES, TabRoute } from '../routes'

const TABS: Array<{ key: TabRoute; label: string; glyph: string }> = [
  { key: 'home', label: '首页', glyph: '⌂' },
  { key: 'assets', label: '资产', glyph: '▦' },
  { key: 'indicators', label: '指标', glyph: '◈' },
]

export function BottomTabBar({ current }: { current: TabRoute }) {
  const switchTab = (key: TabRoute) => {
    if (key !== current) Taro.switchTab({ url: ROUTES[key] })
  }
  return (
    <View className="bottom-tab-bar">
      {TABS.map((tab) => (
        <View
          key={tab.key}
          className={`bottom-tab-item ${current === tab.key ? 'bottom-tab-active' : ''}`}
          onClick={() => switchTab(tab.key)}
        >
          <Text className="bottom-tab-glyph">{tab.glyph}</Text>
          <Text>{tab.label}</Text>
        </View>
      ))}
    </View>
  )
}
