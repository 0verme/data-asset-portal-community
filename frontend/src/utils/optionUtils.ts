// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export interface DictOption {
  code: string;
  value: string;
  name: string;
  legacy?: boolean;
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

export function findDictOption<T extends OptionInputItem | DictOption>(options: readonly T[] = [], value = ''): T | null {
  return options.find((item) => {
    if (typeof item === 'string') return item === value;
    const record = item as Record<string, unknown>;
    return record['value'] === value;
  }) || null;
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
