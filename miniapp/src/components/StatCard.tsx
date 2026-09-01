import { Text, View } from '@tarojs/components'

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="stat-card">
      <Text className="stat-value">{value}</Text>
      <Text className="stat-label">{label}</Text>
    </View>
  )
}
