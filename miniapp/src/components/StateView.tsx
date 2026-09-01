import { Button, Text, View } from '@tarojs/components'

interface StateViewProps {
  status: 'loading' | 'empty' | 'error'
  message?: string
  onRetry?: () => void
}

export function StateView({ status, message, onRetry }: StateViewProps) {
  const title = status === 'loading' ? '加载中' : status === 'empty' ? '暂无数据' : '加载失败'
  return (
    <View className={`state-view state-${status}`}>
      <Text className="state-title">{title}</Text>
      <Text className="state-message">{message || (status === 'error' ? '加载失败，请稍后重试' : '')}</Text>
      {status === 'error' && onRetry ? <Button className="state-retry" onClick={onRetry}>重新加载</Button> : null}
    </View>
  )
}
