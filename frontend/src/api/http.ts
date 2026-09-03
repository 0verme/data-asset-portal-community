// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  REQUEST_TIMEOUT,
  formatTimeoutLabel,
  resolveRequestTimeout,
  summarizeRequestPayload,
} from '../config/request.ts';
import { createInFlightGetRequestGroup } from './inFlightRequests.ts';

const API_BASE_URL = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_BASE_URL']
    ? String(import.meta.env['VITE_API_BASE_URL'])
    : '/api'
).replace(/\/$/, '');

const runInFlightGetRequest = createInFlightGetRequestGroup();

export interface RemoteRequestOptions {
  method?: string | undefined;
  params?: Record<string, unknown> | undefined;
  body?: unknown | undefined;
  timeout?: number | undefined;
  timeoutMs?: number | undefined;
  credentials?: RequestCredentials | undefined;
  suppressUnauthorizedEvent?: boolean | undefined;
  signal?: AbortSignal | null | undefined;
  headers?: Record<string, string> | undefined;
}

export interface ApiHttpError extends Error {
  status?: number | undefined;
  payload?: unknown | undefined;
}

export function buildUrl(path: string, params?: Record<string, unknown> | null): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
  const url = new URL(`${API_BASE_URL}${path}`, origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return `${url.pathname}${url.search}`;
}

export function isUnauthorizedError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { status?: unknown }).status === 401);
}

function resolveNow(): number {
  return (typeof performance !== 'undefined' && performance.now?.()) || Date.now();
}

export async function requestRemote<T = unknown>(path: string, options: RemoteRequestOptions = {}): Promise<T> {
  const timeoutMs = resolveRequestTimeout(options.timeout ?? options.timeoutMs, REQUEST_TIMEOUT);
  const requestUrl = buildUrl(path, options.params);
  const method = String(options.method || 'GET').toUpperCase();
  const credentials = options.credentials || 'include';

  return runInFlightGetRequest<T>(
    {
      method,
      requestUrl,
      credentials,
      timeoutMs,
      suppressUnauthorizedEvent: options.suppressUnauthorizedEvent,
      signal: options.signal,
      hasBody: options.body !== undefined,
    },
    async () => {
      const controller = new AbortController();
      const abortFromCaller = (): void => controller.abort();
      if (options.signal?.aborted) controller.abort();
      else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
      const startedAt = resolveNow();
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const fetchInit: RequestInit = {
          method,
          credentials,
          headers: {
            Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
          },
          signal: controller.signal,
        };
        if (options.body !== undefined) {
          fetchInit.body = JSON.stringify(options.body);
        }
        const response = await fetch(requestUrl, fetchInit);

        const contentType = response.headers.get('content-type') || '';
        const payload: unknown = contentType.includes('application/json')
          ? await response.json()
          : await response.text();

        if (typeof payload === 'string') {
          const trimmed = payload.trim();
          const looksLikeHtml =
            contentType.includes('text/html') ||
            /^<!doctype html/i.test(trimmed) ||
            /^<html[\s>]/i.test(trimmed);

          if (looksLikeHtml) {
            throw new Error(
              '接口返回的是 HTML 页面而不是 JSON，请检查 Vite /api 代理或后端服务是否已启动。',
            );
          }
        }

        if (!response.ok) {
          const record = payload as Record<string, unknown> | null | undefined;
          const errorObj = record?.['error'] as Record<string, unknown> | undefined;
          const message =
            (typeof errorObj?.['message'] === 'string' ? errorObj['message'] : undefined) ||
            (typeof record?.['message'] === 'string' ? record['message'] : undefined) ||
            `请求失败: ${response.status} ${response.statusText}`;

          const error: ApiHttpError = new Error(message);
          error.status = response.status;
          error.payload = payload;
          if (response.status === 401 && !options.suppressUnauthorizedEvent) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('app:unauthorized'));
            }
          }
          throw error;
        }

        return payload as T;
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (!timedOut) {
            throw error;
          }
          const durationMs = Math.round(resolveNow() - startedAt);
          console.warn('[request-timeout]', {
            method,
            url: requestUrl,
            timeoutMs,
            durationMs,
            params: summarizeRequestPayload(options.params),
            body: summarizeRequestPayload(options.body),
          });
          throw new Error(
            `接口请求超时（${formatTimeoutLabel(timeoutMs)}），可能是查询数据量较大或后端处理较慢，请稍后重试。`,
          );
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  );
}
