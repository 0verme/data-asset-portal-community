export const SEMANTIC_STATE_META: Record<string, { label: string; tone: 'info' | 'ok' | 'warn' | 'danger' }> = {
  candidate: { label: '候选', tone: 'warn' },
  certified: { label: '已认证', tone: 'ok' },
  deprecated: { label: '已废弃', tone: 'danger' },
}

export const RUNTIME_STATUS_META: Record<string, { label: string; tone: 'ok' | 'danger' }> = {
  enabled: { label: '已启用', tone: 'ok' },
  disabled: { label: '已禁用', tone: 'danger' },
}

export function getStatusMeta(kind: 'runtime' | 'semantic', value = '') {
  return (kind === 'runtime' ? RUNTIME_STATUS_META : SEMANTIC_STATE_META)[value]
}
