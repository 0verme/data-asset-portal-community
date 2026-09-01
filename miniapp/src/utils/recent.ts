import Taro from '@tarojs/taro'
import { normalizeRecentItems, PENDING_INDICATOR_KEY, RECENT_STORAGE_KEY, RecentItem } from './recent-utils'

export { normalizeRecentItems, PENDING_INDICATOR_KEY, RECENT_STORAGE_KEY }
export type { RecentItem }

const MAX_RECENT_ITEMS = 6

export function readRecentItems() {
  return normalizeRecentItems(Taro.getStorageSync(RECENT_STORAGE_KEY))
    .sort((left, right) => right.visitedAt - left.visitedAt)
}

export function addRecentItem(item: Omit<RecentItem, 'visitedAt'>, now = Date.now()) {
  const next = normalizeRecentItems([
    { ...item, visitedAt: now },
    ...readRecentItems().filter((current) => !(current.id === item.id && current.type === item.type)),
  ]).slice(0, MAX_RECENT_ITEMS)
  Taro.setStorageSync(RECENT_STORAGE_KEY, next)
  return next
}
