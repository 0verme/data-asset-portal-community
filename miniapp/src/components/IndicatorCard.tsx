import { Button, Text, View } from '@tarojs/components'
import { Indicator } from '../api/indicators'
import { StatusTag } from './StatusTag'

interface IndicatorCardProps {
  indicator: Indicator
  expanded: boolean
  detailLoading: boolean
  detailError: boolean
  onToggle: () => void
}

export function IndicatorCard({ indicator, expanded, detailLoading, detailError, onToggle }: IndicatorCardProps) {
  return (
    <View className="content-card indicator-card">
      <View className="card-title-row">
        <Text className="card-title">{indicator.name || indicator.id}</Text>
        <StatusTag value={indicator.semanticState} kind="semantic" />
      </View>
      <Text className="card-subtitle">{indicator.id}</Text>
      <View className="tag-row">
        {indicator.dimension ? <Text className="tag tag-neutral">{indicator.dimension}</Text> : null}
        <StatusTag value={indicator.status} kind="runtime" />
      </View>
      <Text className="card-description">{indicator.meaning || '暂无业务含义'}</Text>
      <View className="meta-row">
        {indicator.registrar ? <Text><Text className="meta-item-label">负责人：</Text>{indicator.registrar}</Text> : null}
        {indicator.path ? <Text><Text className="meta-item-label">分类：</Text>{indicator.path}</Text> : null}
      </View>
      <Button className="card-action" onClick={onToggle}>
        {detailLoading ? '加载详情中…' : expanded ? '收起详情 ↑' : '展开详情 ↓'}
      </Button>
      {expanded && detailError ? <Text className="state-message">详情加载失败，请再次点击重试</Text> : null}
      {expanded ? (
        <View className="detail-list">
          <View className="detail-row"><Text className="detail-label">业务口径</Text><Text className="detail-value">{indicator.caliber || '暂无'}</Text></View>
          <View className="detail-row"><Text className="detail-label">来源资产</Text><Text className="detail-value">{indicator.sourceAssetQualifiedName || indicator.sourceAssetName || '暂无'}</Text></View>
          <View className="detail-row"><Text className="detail-label">来源字段</Text><Text className="detail-value">{indicator.resultFieldName || '暂无'}</Text></View>
          <View className="detail-row"><Text className="detail-label">聚合方式</Text><Text className="detail-value">{indicator.aggregation || '暂无'}</Text></View>
          <View className="detail-row"><Text className="detail-label">负责人</Text><Text className="detail-value">{indicator.registrar || '暂无'}</Text></View>
        </View>
      ) : null}
    </View>
  )
}
