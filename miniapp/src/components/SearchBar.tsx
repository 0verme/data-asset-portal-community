import { Button, Input, Text, View } from '@tarojs/components'

interface SearchBarProps {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onSearch: () => void
}

export function SearchBar({ value, placeholder, onChange, onSearch }: SearchBarProps) {
  return (
    <View className="search-bar">
      <Text className="search-icon">⌕</Text>
      <Input
        className="search-input"
        value={value}
        placeholder={placeholder}
        confirmType="search"
        onInput={(event) => onChange(event.detail.value)}
        onConfirm={onSearch}
      />
      <Button className="search-button" onClick={onSearch}>搜索</Button>
    </View>
  )
}
