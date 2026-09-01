import { Text } from '@tarojs/components'
import { getStatusMeta } from '../utils/status'

interface StatusTagProps {
  value?: string
  kind: 'runtime' | 'semantic'
}

export function StatusTag({ value, kind }: StatusTagProps) {
  const meta = getStatusMeta(kind, value)
  if (!meta) return null
  const marker = meta.tone === 'ok' ? '●' : meta.tone === 'danger' ? '○' : '•'
  return <Text className={`tag tag-${meta.tone}`}>{marker} {meta.label}</Text>
}
