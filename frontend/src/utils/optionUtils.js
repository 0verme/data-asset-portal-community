// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export function normalizeDictOptions(items = []) {
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { code: "", value: item, name: item };
      }
      return {
        code: item?.code || item?.itemCode || "",
        value: item?.value || item?.name || "",
        name: item?.name || item?.value || "",
      };
    })
    .filter((item) => item.value);
}

export function optionsFromValues(values = []) {
  const seen = new Set();
  return normalizeDictOptions(values).filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

export function findDictOption(options = [], value = "") {
  return options.find((item) => (typeof item === "string" ? item === value : item?.value === value)) || null;
}

export function isLegacyDictValue(options = [], value = "") {
  return Boolean(value) && !findDictOption(options, value);
}

export function getLegacyAwareOptions(options = [], currentValue = "") {
  if (!isLegacyDictValue(options, currentValue)) return options;
  return [
    ...options,
    {
      code: "__legacy__",
      value: currentValue,
      name: currentValue,
      legacy: true,
    },
  ];
}
