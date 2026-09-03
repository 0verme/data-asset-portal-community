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

const THEME_STORAGE_KEY = 'dap-theme';

export { THEME_STORAGE_KEY };

export type ThemeMode = 'light' | 'dark';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  return 'light';
}

export function scrollMainToTop(): void {
  window.scrollTo(0, 0);
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
}

export interface OptionItemLike {
  name?: string | undefined;
  value?: string | undefined;
  [key: string]: unknown;
}

export function optionLabel(option?: string | OptionItemLike | null): string {
  if (typeof option === 'string') return option;
  return option?.name || option?.value || '';
}

export interface ErrorDetailItem {
  field?: string | undefined;
  message?: string | undefined;
}

export interface ErrorWithPayload extends Error {
  payload?: {
    error?: {
      details?: Array<string | ErrorDetailItem> | undefined;
      message?: string | undefined;
    } | undefined;
  } | undefined;
}

const VALIDATION_FIELD_LABELS: Record<string, string> = {
  dbType: "数据库类型",
  dept: "业务部门",
};

export function getErrorMessage(error?: unknown, fallback = '操作失败，请稍后重试。'): string {
  const errWithPayload = error as ErrorWithPayload | undefined;
  const details = errWithPayload?.payload?.error?.details;
  if (Array.isArray(details)) {
    const messages = details
      .map((detail) => {
        if (typeof detail === 'string') return detail.trim();
        if (!detail || typeof detail.message !== 'string') return '';
        const message = detail.message.trim();
        const field = typeof detail.field === 'string' ? detail.field.trim() : '';
        const fieldLabel = VALIDATION_FIELD_LABELS[field] || field;
        return fieldLabel && message ? `${fieldLabel}：${message}` : message;
      })
      .filter(Boolean);
    if (messages.length) return [...new Set(messages)].join('；');
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
