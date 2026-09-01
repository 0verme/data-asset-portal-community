import Taro, { useLoad } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { useState } from 'react'
import { Asset, AssetField, getAssetDdl, getAssetDetail, getAssetFields } from '../../api/assets'
import { BottomTabBar } from '../../components/BottomTabBar'
import { SectionHeader } from '../../components/SectionHeader'
import { StateView } from '../../components/StateView'
import { addRecentItem } from '../../utils/recent'

export default function AssetDetailPage() {
  const [tableName, setTableName] = useState('')
  const [asset, setAsset] = useState(null as Asset | null)
  const [fields, setFields] = useState([] as AssetField[])
  const [expandedFields, setExpandedFields] = useState(false)
  const [ddl, setDdl] = useState(null as { ddl: string; dialect: string } | null)
  const [ddlLoading, setDdlLoading] = useState(false)
  const [ddlError, setDdlError] = useState(false)
  const [status, setStatus] = useState('loading')

  const load = async (name: string) => {
    if (!name) {
      setStatus('error')
      return
    }
    setStatus('loading')
    try {
      const [detail, fieldList] = await Promise.all([getAssetDetail(name), getAssetFields(name)])
      setAsset(detail)
      setFields(fieldList.length ? fieldList : detail.fields)
      setStatus('success')
      addRecentItem({ id: name, type: 'asset', title: detail.cn || name, subtitle: name })
    } catch {
      setStatus('error')
    }
  }

  useLoad((options) => {
    const name = String(options?.table || '')
    setTableName(name)
    void load(name)
  })

  const loadDdl = () => {
    if (!tableName || ddlLoading) return
    setDdlLoading(true)
    setDdlError(false)
    void getAssetDdl(tableName).then(setDdl).catch(() => setDdlError(true)).finally(() => setDdlLoading(false))
  }

  if (status === 'loading') return <View className="app-page"><StateView status="loading" /></View>
  if (status === 'error' || !asset) return <View className="app-page"><StateView status="error" onRetry={() => load(tableName)} /></View>

  const visibleFields = expandedFields ? fields : fields.slice(0, 8)
  return (
    <View className="app-page asset-detail-page">
      <Button className="detail-back" onClick={() => Taro.navigateBack({ delta: 1 })}>← 返回</Button>
      <View className="content-card">
        <Text className="detail-hero-title">{asset.cn || asset.name}</Text>
        <Text className="card-subtitle">{asset.name}</Text>
        <View className="tag-row">
          {asset.layer ? <Text className="tag tag-neutral">{asset.layer}</Text> : null}
          {asset.domain ? <Text className="tag tag-neutral">{asset.domain}</Text> : null}
        </View>
        <View className="detail-list">
          <View className="detail-row"><Text className="detail-label">负责人</Text><Text className="detail-value">{asset.owner || '暂无'}</Text></View>
          <View className="detail-row"><Text className="detail-label">更新时间</Text><Text className="detail-value">{asset.updatedAt || '接口未提供'}</Text></View>
          <View className="detail-row"><Text className="detail-label">粒度 / 周期</Text><Text className="detail-value">{[asset.grain, asset.cycle].filter(Boolean).join(' / ') || '暂无'}</Text></View>
        </View>
      </View>

      <SectionHeader title="业务描述" />
      <View className="content-card"><Text className="card-description">{asset.desc || '暂无业务描述'}</Text></View>

      <SectionHeader title="字段列表" extra={`${fields.length} 个`} />
      <View className="content-card">
        {!fields.length ? <StateView status="empty" message="当前资产暂无字段信息" /> : null}
        {fields.length ? (
          <View className="detail-list">
            {visibleFields.map((field) => (
              <View className="field-row" key={`${field.name}-${field.fieldId}`}>
                <Text className="field-name">{field.name}{field.pk ? <Text className="field-pk">主键</Text> : null}</Text>
                <Text className="field-cn">{field.cn || '—'}</Text>
                <Text className="field-type">{field.type || '—'}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {fields.length > 8 ? <Button className="load-more-button" onClick={() => setExpandedFields((value) => !value)}>{expandedFields ? '收起字段' : '查看更多字段'}</Button> : null}
      </View>

      <SectionHeader title="关联资产" />
      <View className="content-card"><Text className="related-note">上游、下游、指标和报表数量未包含在当前公开详情接口中，暂不展示推测数字。</Text></View>

      <SectionHeader title="技术信息" />
      <View className="content-card">
        <View className="detail-list">
          <View className="detail-row"><Text className="detail-label">存储类型</Text><Text className="detail-value">{asset.schema || '接口未提供'}</Text></View>
          <View className="detail-row"><Text className="detail-label">字段数量</Text><Text className="detail-value">{asset.fieldCount}</Text></View>
        </View>
        <Button className="load-more-button" onClick={loadDdl}>{ddlLoading ? '加载 DDL 中…' : ddl ? '刷新 DDL' : '查看 DDL'}</Button>
        {ddlError ? <StateView status="error" message="DDL 加载失败，请稍后重试" onRetry={loadDdl} /> : null}
        {ddl ? <View><Text className="state-message">方言：{ddl.dialect || '接口未标注'}</Text><Text className="code-block">{ddl.ddl || '接口未返回 DDL'}</Text></View> : null}
      </View>
      <BottomTabBar current="assets" />
    </View>
  )
}
