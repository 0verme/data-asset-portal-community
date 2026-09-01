import { buildApiUrl, normalizeApiError } from './http-utils'

export * from './http-utils'

export type QueryParams = Record<string, string | number | undefined>

export async function requestJson<T>(path: string, options: { params?: QueryParams; timeout?: number } = {}) {
  try {
    const { default: Taro } = await import('@tarojs/taro')
    const response = await Taro.request<T>({
      url: buildApiUrl(path),
      method: 'GET',
      data: options.params,
      timeout: options.timeout || 10000,
    })
    if (response.statusCode >= 200 && response.statusCode < 300) return response.data
    throw normalizeApiError({ statusCode: response.statusCode, data: response.data })
  } catch (error) {
    throw normalizeApiError(error)
  }
}
