// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export interface DictOption {
  code: string;
  value: string;
  name: string;
  legacy?: boolean;
  [key: string]: unknown;
}

export interface RawOptionItem {
  code?: string | undefined;
  itemCode?: string | undefined;
  value?: string | undefined;
  name?: string | undefined;
}

export type OptionInputItem = string | RawOptionItem | Record<string, unknown>;

export function normalizeDictOptions(items: readonly OptionInputItem[] = []): DictOption[] {
  return items
    .map((item) => {
      if (typeof item === 'string') {
        return { code: '', value: item, name: item };
      }
      const record = item as Record<string, unknown>;
      const code = typeof record['code'] === 'string' ? record['code'] : typeof record['itemCode'] === 'string' ? record['itemCode'] : '';
      const value = typeof record['value'] === 'string' ? record['value'] : typeof record['name'] === 'string' ? record['name'] : '';
      const name = typeof record['name'] === 'string' ? record['name'] : typeof record['value'] === 'string' ? record['value'] : '';
      return {
        code,
        value,
        name,
      };
    })
    .filter((item) => Boolean(item.value));
}

export function optionsFromValues(values: readonly OptionInputItem[] = []): DictOption[] {
  const seen = new Set<string>();
  return normalizeDictOptions(values).filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function optionKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function findDictOption<T extends OptionInputItem | DictOption>(options: readonly T[] = [], value = ''): T | null {
  const target = optionKey(value);
  if (!target) return null;
  return options.find((item) => {
    if (typeof item === 'string') return optionKey(item) === target;
    const record = item as Record<string, unknown>;
    return ['value', 'code', 'name'].some((key) => optionKey(record[key]) === target);
  }) || null;
}

export function normalizeDictValue(options: readonly OptionInputItem[] = [], value = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const option = findDictOption(options, normalized);
  if (!option) return normalized;
  if (typeof option === 'string') return option;
  const record = option as Record<string, unknown>;
  if (typeof record['value'] === 'string') return record['value'];
  if (typeof record['name'] === 'string') return record['name'];
  return normalized;
}

export function displayDictValue(options: readonly OptionInputItem[] = [], value = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const option = findDictOption(options, normalized);
  if (!option) return normalized;
  if (typeof option === 'string') return option;
  const record = option as Record<string, unknown>;
  if (typeof record['name'] === 'string') return record['name'];
  if (typeof record['value'] === 'string') return record['value'];
  return normalized;
}

export function isLegacyDictValue(options: readonly OptionInputItem[] = [], value = ''): boolean {
  return Boolean(value) && !findDictOption(options, value);
}

export function getLegacyAwareOptions<T extends OptionInputItem>(options: readonly T[] = [], currentValue = ''): Array<T | DictOption> {
  if (!isLegacyDictValue(options, currentValue)) return [...options];
  return [
    ...options,
    {
      code: '__legacy__',
      value: currentValue,
      name: currentValue,
      legacy: true,
    },
  ];
}
