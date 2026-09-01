import { Button, Text, View } from '@tarojs/components'
import { Asset } from '../api/assets'

export function AssetCard({ asset, onView }: { asset: Asset; onView: () => void }) {
  return (
    <View className="content-card asset-card">
      <View className="card-title-row">
        <Text className="card-title">{asset.cn || asset.name}</Text>
        <Text className="tag tag-neutral">{asset.layer || '未分层'}</Text>
      </View>
      <Text className="card-subtitle">{asset.name}</Text>
      <View className="tag-row">
        {asset.domain ? <Text className="tag tag-neutral">{asset.domain}</Text> : null}
        <Text className="tag tag-info">{asset.fieldCount} 个字段</Text>
      </View>
      <View className="meta-row">
        {asset.owner ? <Text><Text className="meta-item-label">负责人：</Text>{asset.owner}</Text> : null}
        {asset.schema ? <Text><Text className="meta-item-label">Schema：</Text>{asset.schema}</Text> : null}
      </View>
      <Button className="card-action" onClick={onView}>查看详情 →</Button>
    </View>
  )
}
