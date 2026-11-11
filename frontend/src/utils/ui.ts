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
const ACCENT_STORAGE_KEY = 'dap-accent';

export { ACCENT_STORAGE_KEY, THEME_STORAGE_KEY };

export type ThemeMode = 'light' | 'dark';
export type AccentPreset = 'green' | 'purple';

export function resolveDefaultAccent(value: unknown): AccentPreset {
  return typeof value === 'string' && value.trim().toLowerCase() === 'purple'
    ? 'purple'
    : 'green';
}

const DEFAULT_ACCENT = resolveDefaultAccent(
  typeof import.meta !== 'undefined' ? import.meta.env?.['VITE_DEFAULT_ACCENT'] : undefined,
);

export function applyThemeAttributes(
  theme: ThemeMode,
  root: Pick<HTMLElement, 'dataset'>,
): void {
  root.dataset['theme'] = theme;
  root.dataset['mode'] = theme;
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return 'light';
}

export function applyAccentAttributes(
  accent: AccentPreset,
  root: Pick<HTMLElement, 'dataset'>,
): void {
  root.dataset['accent'] = accent;
}

export function getInitialAccent(defaultAccent: AccentPreset = DEFAULT_ACCENT): AccentPreset {
  if (typeof window === 'undefined') return defaultAccent;
  try {
    const savedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (savedAccent === 'green' || savedAccent === 'purple') return savedAccent;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return defaultAccent;
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
