import { Text, View } from '@tarojs/components'

export function SectionHeader({ title, extra }: { title: string; extra?: string }) {
  return (
    <View className="section-header">
      <Text className="section-title">{title}</Text>
      {extra ? <Text className="section-extra">{extra}</Text> : null}
    </View>
  )
}
