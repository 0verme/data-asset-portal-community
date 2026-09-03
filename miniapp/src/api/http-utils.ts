export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:15099/api'

export function normalizeBaseUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '')
}

export const API_BASE_URL = normalizeBaseUrl(process.env.TARO_APP_API_BASE_URL || DEFAULT_API_BASE_URL)

export function buildApiUrl(path: string, baseUrl = API_BASE_URL) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path}`
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(message: string, status = 0, code = 'REQUEST_FAILED') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const record = recordOf(error)
  const payload = recordOf(record?.data) || recordOf(record?.response)
  const nested = recordOf(payload?.error)
  const status = Number(record?.statusCode || record?.status || 0) || 0
  const message = String(
    nested?.message || payload?.message || record?.message || '请求失败，请稍后重试',
  )
  const code = String(nested?.code || payload?.code || record?.code || 'REQUEST_FAILED')
  return new ApiError(message, status, code)
}
